import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput, ScenarioGMContext, LedgerEntry, LocationEntry, NpcEntry } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";
import { resolveAction, rollInjuryDamage, rollFirstAidHeal, InjurySeverity } from "@/lib/game/resolution";
import { refreshStorySummary } from "@/lib/ai/summarize";
import { detectEnding } from "@/lib/ai/detect-ending";
import {
  decomposeObjectives,
  decomposeStructuredObjectives,
  checkObjectiveProgress,
  checkFailureTriggered,
  generateFailureNarration,
  incompleteForActor,
  applyCompletions,
  allRequiredDone,
  generateVictoryNarration,
  Objective,
  ObjectiveProgress,
} from "@/lib/ai/objectives";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    roomId: string;
    actionText: string;
    actingUserId: string;
    characterId: string;
  };
  const { roomId, actionText, actingUserId, characterId } = body;

  // Verify caller is a room participant and it's actually their turn
  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules, opening_scene, locations, npcs, winning_targets, each_player_targets, failure_conditions, failure_turn_limit, ending_conditions, gm_notes, source_document, language)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.current_turn_player_id !== user.id) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  // Fetch the real party from the database — characters + their player usernames
  const { data: characters } = await supabase
    .from("characters")
    .select("*, users(username)")
    .eq("room_id", roomId);

  if (!characters || characters.length === 0) {
    return NextResponse.json(
      { error: "No characters found in this room — cannot generate GM response." },
      { status: 400 }
    );
  }

  const sortedByDex = [...characters].sort((a, b) => b.dex - a.dex);
  const currentIndex = sortedByDex.findIndex((c) => c.user_id === user.id);

  // resolvedActor = the character who just submitted the action (narration is about them)
  const resolvedActor = sortedByDex.find((c) => c.user_id === (actingUserId || user.id)) ?? null;

  // Pull the most recent GM narration so horror in the current scene can also
  // trigger a SAN check, not just the player's own action wording.
  const { data: lastGm } = await supabase
    .from("story_logs")
    .select("content")
    .eq("room_id", roomId)
    .eq("entry_type", "gm_response")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const sceneContext = lastGm?.content ?? "";

  // === DICE RESOLUTION ===
  // The SYSTEM decides the outcome; the GM only narrates it.
  const roll = resolvedActor
    ? resolveAction(actionText, resolvedActor, sceneContext)
    : null;

  let actorDied = false;
  let actorBroke = false;
  // Total SAN change = action's own SAN change + horror SAN-check loss (separate roll).
  const sanCheckLoss = roll?.san_check?.san_loss ?? 0;
  const totalSanChange = (roll?.san_change ?? 0) - sanCheckLoss;
  if (roll && resolvedActor && roll.requires_check && (roll.hp_change !== 0 || totalSanChange !== 0)) {
    const newHp = Math.max(0, resolvedActor.hp + roll.hp_change);
    const newSan = Math.max(0, resolvedActor.san + totalSanChange);
    actorDied = newHp <= 0;
    actorBroke = newSan <= 0;
    await supabase.from("characters")
      .update({ hp: newHp, san: newSan })
      .eq("id", resolvedActor.id);
    resolvedActor.hp = newHp;
    resolvedActor.san = newSan;
  }

  // Save action to story_logs, with the dice result attached to the action entry.
  await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: room.current_round,
    entry_type: "action",
    player_id: user.id,
    character_id: characterId,
    content: actionText,
    roll_result: roll,
  });

  // === FIRST AID — heals a TARGET (any roster member, including self) ===
  // Tied to the 急救 skill check the actor just rolled. Each character may only
  // be healed once per "scene" (approximated by round number — resets when the
  // round advances), preventing chain-healing from trivializing damage.
  if (roll?.stat_used === "急救" && (roll.outcome === "success" || roll.outcome === "critical_success")) {
    const actingName2 = resolvedActor?.name ?? "Unknown";
    const targetChar =
      sortedByDex.find((c: any) => c.name !== actingName2 && actionText.includes(c.name)) ?? resolvedActor;

    if (targetChar && targetChar.hp > 0) {
      const rawLog = room.first_aid_log as { round: number; healed: string[] } | null;
      const healedThisScene = rawLog && rawLog.round === room.current_round ? rawLog.healed : [];
      let firstAidNote: string;

      if (healedThisScene.includes(targetChar.name)) {
        firstAidNote = `${targetChar.name} 在這個場景已經接受過急救，這次沒有額外效果。`;
      } else {
        const healAmount = rollFirstAidHeal(roll.outcome);
        const maxHp = Math.floor((targetChar.con + targetChar.siz) / 10);
        const newHp = Math.min(maxHp, targetChar.hp + healAmount);
        await supabase.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
        targetChar.hp = newHp;

        await supabase.from("rooms").update({
          first_aid_log: { round: room.current_round, healed: [...healedThisScene, targetChar.name] },
        }).eq("id", roomId);

        firstAidNote = `🩹 ${actingName2} 為 ${targetChar.name} 進行急救，恢復 ${healAmount} HP（${newHp}/${maxHp}）。`;
      }

      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: firstAidNote,
      });
    }
  }

  // Advance turn — skip characters who are dead (HP<=0 or SAN<=0). nextActor = now-active character.
  const isDown = (c: any) => c.hp <= 0 || c.san <= 0;
  let nextRound = room.current_round;
  let nextPlayerId: string;
  let nextActor = sortedByDex[0];
  for (let step = 1; step <= sortedByDex.length; step++) {
    const idx = currentIndex + step;
    if (idx >= sortedByDex.length && nextRound === room.current_round) {
      nextRound = room.current_round + 1;
    }
    const candidate = sortedByDex[idx % sortedByDex.length];
    if (!isDown(candidate) || step === sortedByDex.length) {
      nextActor = candidate;
      break;
    }
  }
  nextPlayerId = nextActor?.user_id ?? user.id;

  // Clear old choices immediately
  await supabase.from("rooms").update({
    current_turn_player_id: nextPlayerId,
    current_round: nextRound,
    current_choices: [],
    current_choices_for_player_id: null,
  }).eq("id", roomId);

  if (nextRound !== room.current_round) {
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: nextRound,
      entry_type: "system",
      content: `--- Round ${nextRound} begins ---`,
    });
  }

  // Fetch last N turns for immediate continuity — older history lives in summary+ledger.
  // Must cover at least one full round so the GM always sees every player's last action
  // regardless of party size (a 4-player round has 4 consecutive turns).
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(8);

  const storyLogSoFar = (logs ?? [])
    .reverse()
    .map((l: any) => {
      if (l.entry_type === "action") return `${l.characters?.name}: ${l.content}`;
      if (l.entry_type === "gm_response") return `GM: ${l.content}`;
      return l.content;
    });

  // Load the room's persistent memory (summary + ledger)
  const { data: roomMemory } = await supabase
    .from("rooms")
    .select("story_summary, story_ledger")
    .eq("id", roomId)
    .single();
  const storySummary: string | null = roomMemory?.story_summary ?? null;
  const storyLedger: LedgerEntry[] = Array.isArray(roomMemory?.story_ledger) ? roomMemory.story_ledger : [];

  const partyForAI = sortedByDex.map((c: any) => ({
    name: c.name,
    playerName: c.users?.username ?? null,
    background: c.background ?? null,
    dex: c.dex, hp: c.hp, san: c.san, mp: c.mp ?? 0,
    str: c.str, con: c.con, siz: c.siz, app: c.app,
    int: c.int, pow: c.pow, edu: c.edu, luck: c.luck,
  }));

  const scenario = (room as any).scenarios;
  const structuredLocations: LocationEntry[] = Array.isArray(scenario?.locations)
    ? scenario.locations.filter((l: any) => l && typeof l === "object" && typeof l.name === "string") as LocationEntry[]
    : [];
  const structuredNpcs: NpcEntry[] = Array.isArray(scenario?.npcs)
    ? scenario.npcs.filter((n: any) => n && typeof n === "object" && typeof n.name === "string" && typeof n.hp === "number") as NpcEntry[]
    : [];
  const gmContext: ScenarioGMContext | null = scenario ? {
    openingScene: scenario.opening_scene ?? null,
    locations: structuredLocations,
    npcs: structuredNpcs,
    winningTargets: scenario.winning_targets ?? null,
    eachPlayerTargets: scenario.each_player_targets ?? null,
    failureConditions: scenario.failure_conditions ?? null,
    failureTurnLimit: scenario.failure_turn_limit ?? null,
    endingConditions: scenario.ending_conditions ?? null,
    gmNotes: scenario.gm_notes ?? null,
    sourceDocument: scenario.source_document ?? null,
  } : null;

  // === DETERMINISTIC LEDGER POPULATION ===
  // Facts that must never be forgotten are appended here before the AI call.
  // The AI can also add up to 2 narrative facts via its `memory` field (below).
  const newLedgerEntries: LedgerEntry[] = [];
  const turnLabel = room.current_round;
  const actorName = resolvedActor?.name ?? "Unknown";

  if (roll?.requires_check) {
    const outcome = roll.outcome ?? "";
    const isInvestigation = ["偵查", "聆聽", "圖書館使用", "心理學", "神秘學", "spot_hidden", "library_use", "occult"].includes(roll.stat_used ?? "");

    if ((outcome === "critical_success" || outcome === "success") && isInvestigation) {
      newLedgerEntries.push({ turn: turnLabel, type: "clue", character: actorName, fact: `成功調查：${actionText.slice(0, 80)}` });
    }
    if (actorDied) {
      newLedgerEntries.push({ turn: turnLabel, type: "death", character: actorName, fact: `${actorName} 的 HP 歸零，已陣亡。` });
    }
    if (actorBroke) {
      newLedgerEntries.push({ turn: turnLabel, type: "san_break", character: actorName, fact: `${actorName} 的 SAN 歸零，精神崩潰。` });
    }
    if (roll.san_check && !roll.san_check.success) {
      newLedgerEntries.push({ turn: turnLabel, type: "event", character: actorName, fact: `遭遇恐怖（${roll.san_check.severity_label}），SAN −${roll.san_check.san_loss}。` });
    }
  }

  const updatedLedger = [...storyLedger, ...newLedgerEntries];

  // === OBJECTIVE STATUS (GM-only) ===
  // Tell the GM which objectives are already satisfied as of the start of this
  // turn, so it never re-narrates a completed goal as still pending (e.g. a key
  // already found). This is GM-internal — players never see a checklist (we hide
  // 任務目標 from the UI). Lives in the per-turn message since progress changes.
  const objList: Objective[] = Array.isArray(room.objectives) ? room.objectives : [];
  const objProgress: ObjectiveProgress =
    room.objective_progress && typeof room.objective_progress === "object" ? room.objective_progress : {};
  let objectiveDirective: string | null = null;
  if (objList.length > 0) {
    const livingNames = sortedByDex.filter((c: any) => c.hp > 0 && c.san > 0).map((c: any) => c.name);
    const lines = objList.map((o) => {
      const entry = objProgress[o.id];
      if (o.scope === "each_player") {
        const doneNames = entry ? Object.keys(entry.by ?? {}) : [];
        const allDone = entry?.done === true;
        return `- [${allDone ? "已完成" : `進行中 ${doneNames.length}/${livingNames.length}`}] ${o.text}（每位存活玩家各自完成）`;
      }
      return `- [${entry?.done ? "已完成" : "未完成"}] ${o.text}`;
    });
    objectiveDirective =
      `OBJECTIVE TRACKER (GM-internal — NEVER reveal this list or its wording to players):\n${lines.join("\n")}\n` +
      `Treat "已完成" goals as DONE: do not re-introduce them, hint they are unmet, or make players redo them. Steer the unfinished ones, but only through natural play — never announce the checklist.`;
  }

  const input: GMAIInput = {
    scenarioTitle: scenario?.title ?? "Unknown Scenario",
    scenarioBackground: scenario?.background ?? null,
    scenarioObjective: scenario?.objective ?? null,
    scenarioRules: scenario?.rules ?? null,
    scenarioLanguage: scenario?.language ?? null,
    scenarioGMContext: gmContext,
    characters: partyForAI,
    storySummary,
    storyLedger: updatedLedger,
    storyLogSoFar,
    npcStates: (room.npc_states && typeof room.npc_states === "object") ? room.npc_states : null,
    objectiveDirective,
    currentRound: room.current_round,
    actingCharacterName: resolvedActor?.name ?? "Unknown",
    nextCharacterName: nextActor?.name ?? "Unknown",
    playerAction: actionText,
    resolution: roll
      ? {
          requiresCheck: roll.requires_check,
          statUsed: roll.stat_used,
          target: roll.target,
          d100: roll.d100_roll,
          outcome: roll.outcome,
          consequenceSummary: roll.consequence_summary,
          hpChange: roll.hp_change,
          sanChange: roll.san_change,
          actorDied,
          actorBroke,
          sanCheck: roll.san_check
            ? {
                severityLabel: roll.san_check.severity_label,
                pow: roll.san_check.pow,
                roll: roll.san_check.roll,
                success: roll.san_check.success,
                sanLoss: roll.san_check.san_loss,
              }
            : null,
        }
      : null,
  };

  try {
    const gmResponse = await generateGMResponse(input);

    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "gm_response",
      content: gmResponse.narration,
    });

    // === GM-FLAGGED INJURY — server rolls & applies the actual damage ===
    // The GM only classifies WHO got hurt and HOW BADLY; the dice math and HP
    // writes are entirely server-side, preserving tamper-resistance.
    const injuryLedgerEntries: LedgerEntry[] = [];
    const injury = gmResponse.injury;
    if (injury && injury.target && injury.severity) {
      const validSeverities: InjurySeverity[] = ["minor", "moderate", "serious", "severe"];
      const severity = validSeverities.includes(injury.severity) ? injury.severity : "minor";
      const dmg = rollInjuryDamage(severity);

      if (injury.is_npc) {
        const npcStates: Record<string, { hp: number; max_hp: number; alive: boolean }> =
          (room.npc_states && typeof room.npc_states === "object") ? { ...room.npc_states } : {};
        let npc = npcStates[injury.target];
        if (!npc) {
          const declaredNpc = structuredNpcs.find((n: NpcEntry) => n.name === injury.target);
          const maxHp = declaredNpc ? declaredNpc.hp : Math.max(1, Math.min(30, Math.floor(injury.npc_max_hp ?? 10)));
          npc = { hp: maxHp, max_hp: maxHp, alive: true };
        }
        if (npc.alive) {
          npc = { ...npc, hp: Math.max(0, npc.hp - dmg.amount) };
          if (npc.hp <= 0) npc.alive = false;
          npcStates[injury.target] = npc;
          await supabase.from("rooms").update({ npc_states: npcStates }).eq("id", roomId);

          await supabase.from("story_logs").insert({
            room_id: roomId,
            round_number: room.current_round,
            entry_type: "system",
            content: npc.alive
              ? `💢 ${injury.target} 受到${dmg.label}傷害（−${dmg.amount} HP，剩餘 ${npc.hp}/${npc.max_hp}）`
              : `☠ ${injury.target} 傷重不治，已死亡。`,
          });
          injuryLedgerEntries.push({
            turn: turnLabel, type: npc.alive ? "event" : "death", character: injury.target,
            fact: npc.alive ? `受到攻擊（${dmg.label}，${injury.reason ?? ""}）` : `傷重死亡（${injury.reason ?? ""}）`,
          });
        }
      } else {
        const targetChar = sortedByDex.find((c: any) => c.name === injury.target);
        if (targetChar && targetChar.hp > 0) {
          const newHp = Math.max(0, targetChar.hp - dmg.amount);
          await supabase.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
          targetChar.hp = newHp; // keep in sync for the all-dead check below

          await supabase.from("story_logs").insert({
            room_id: roomId,
            round_number: room.current_round,
            entry_type: "system",
            content: newHp > 0
              ? `💢 ${injury.target} 受到${dmg.label}傷害（−${dmg.amount} HP，剩餘 ${newHp}）`
              : `☠ ${injury.target} 傷重倒下。`,
          });
          injuryLedgerEntries.push({
            turn: turnLabel, type: newHp <= 0 ? "death" : "event", character: injury.target,
            fact: newHp <= 0 ? `傷重倒下陣亡（${injury.reason ?? ""}）` : `受到攻擊（${dmg.label}，${injury.reason ?? ""}），HP −${dmg.amount}`,
          });
        }
      }
    }

    // === MEMORY UPDATE ===
    // Append AI-emitted memory items to the ledger (player-visible facts only).
    const aiMemoryEntries: LedgerEntry[] = (gmResponse.memory ?? [])
      .filter((m) => typeof m === "string" && m.trim().length > 0)
      .slice(0, 2)
      .map((fact) => ({ turn: turnLabel, type: "event", character: actorName, fact: fact.trim() }));

    const finalLedger = [...updatedLedger, ...injuryLedgerEntries, ...aiMemoryEntries];

    // Refresh the rolling summary at every round boundary (cheap call, infrequent).
    // The summary absorbs the FULL ledger into 2-sentence prose, so once it has
    // refreshed we prune the STORED ledger down to a recent tail. This keeps both
    // the DB row and the per-turn prompt bounded no matter how long the game runs
    // (older facts survive in the summary), which is the main lever on DeepSeek
    // cache-miss cost — an unbounded ledger is re-sent uncached every single turn.
    const LEDGER_STORE_LIMIT = 30;
    let finalSummary = storySummary;
    let ledgerToStore = finalLedger;
    if (nextRound !== room.current_round) {
      finalSummary = await refreshStorySummary(
        storySummary,
        finalLedger,
        storyLogSoFar,
        scenario?.title ?? "the adventure",
        scenario?.language ?? null,
      );
      ledgerToStore = finalLedger.slice(-LEDGER_STORE_LIMIT);
    }

    // Persist updated ledger and (if refreshed) summary.
    const memoryUpdate: Record<string, any> = { story_ledger: ledgerToStore };
    if (finalSummary !== storySummary) memoryUpdate.story_summary = finalSummary;
    if (Object.keys(memoryUpdate).length > 0) {
      await supabase.from("rooms").update(memoryUpdate).eq("id", roomId);
    }

    // === ENDING DETECTION ===
    // Check 0: failure turn limit reached → forced failure ending.
    if (scenario?.failure_turn_limit && room.current_round >= scenario.failure_turn_limit) {
      const isZhTL = scenario?.language === "zh-TW" || scenario?.language === "zh-CN";
      const tplTitle = isZhTL ? "回合上限已達" : "Turn Limit Reached";
      const tplSummary = isZhTL
        ? `冒險已達回合上限（第 ${scenario.failure_turn_limit} 回合），以失敗告終。`
        : `The adventure reached its turn limit (round ${scenario.failure_turn_limit}) and ends in defeat.`;
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `⚑ THE END — ${tplTitle}`,
      });
      await supabase.from("rooms").update({
        status: "completed",
        ending_type: "failure",
        ending_title: tplTitle,
        ending_summary: tplSummary,
      }).eq("id", roomId);
      return NextResponse.json({
        response: gmResponse.narration,
        gameEnded: true,
        ending: { type: "failure", title: tplTitle, summary: tplSummary },
      });
    }

    // Check 1: all party members dead → forced failure ending (pure code).
    const allDead = sortedByDex.every((c: any) => c.hp <= 0 || c.san <= 0);

    const isZh = scenario?.language === "zh-TW" || scenario?.language === "zh-CN";
    const tpdTitle = isZh ? "全員陣亡" : "Total Party Defeat";
    const tpdSummary = isZh
      ? "所有人都已倒下。黑暗取得了最終的勝利，冒險就此以失敗告終。"
      : "The entire party has fallen. The darkness claims its victory and the adventure ends in defeat.";

    type EndingShape = { triggered: boolean; type: any; title: string | null; summary: string | null };
    let ending: EndingShape = { triggered: false, type: null, title: null, summary: null };
    const actingName = resolvedActor?.name ?? "Unknown";

    if (allDead) {
      ending = { triggered: true, type: "failure", title: tpdTitle, summary: tpdSummary };
    } else if (
      scenario?.winning_targets ||
      scenario?.each_player_targets ||
      scenario?.ending_conditions
    ) {
      // === DETERMINISTIC OBJECTIVE TRACKER ===
      // Progress is stored as PERMANENT FLAGS on the room — the AI never has to
      // remember earlier turns. It only classifies the current action against
      // the still-incomplete objectives; whether the game ends is pure code.

      const partyText = scenario.winning_targets?.trim() ?? "";
      const eachPlayerText = scenario.each_player_targets?.trim() ?? "";

      // 1. Ensure the room has a decomposed objective checklist (build once).
      //    Prefer the creator's STRUCTURED boxes (scope is unambiguous); only
      //    fall back to the legacy free-text ending_conditions for old scenarios
      //    that have neither structured box filled.
      let objectives: Objective[] = Array.isArray(room.objectives) ? room.objectives : [];
      if (objectives.length === 0) {
        objectives =
          partyText || eachPlayerText
            ? await decomposeStructuredObjectives(partyText, eachPlayerText, scenario?.language ?? null)
            : await decomposeObjectives(scenario.ending_conditions, scenario?.language ?? null);
        if (objectives.length > 0) {
          await supabase.from("rooms").update({ objectives }).eq("id", roomId);
        }
      }

      if (objectives.length > 0) {
        let progress: ObjectiveProgress =
          room.objective_progress && typeof room.objective_progress === "object"
            ? { ...room.objective_progress }
            : {};

        // Living characters define who must still complete each_player objectives.
        const livingPlayerNames = sortedByDex.filter((c: any) => c.hp > 0).map((c: any) => c.name);

        // 2. Only ask the AI about objectives this ACTOR hasn't personally done.
        //    (party scope: not done; each_player scope: actor not yet recorded)
        const incomplete = incompleteForActor(objectives, progress, actingName);
        const newlyDone = await checkObjectiveProgress(
          incomplete,
          storyLogSoFar,
          actionText,
          actingName,
          gmResponse.narration
        );

        // 3. Persist completions as PERMANENT flags (scope-aware).
        if (newlyDone.length > 0) {
          progress = applyCompletions(
            objectives,
            progress,
            newlyDone,
            actingName,
            room.current_round,
            livingPlayerNames
          );
          await supabase.from("rooms").update({ objective_progress: progress }).eq("id", roomId);

          // Visible feedback per objective — distinguish personal vs full completion.
          for (const id of newlyDone) {
            const obj = objectives.find((o) => o.id === id);
            if (!obj) continue;
            let content: string;
            if (obj.scope === "each_player" && progress[id]?.done !== true) {
              const done = Object.keys(progress[id]?.by ?? {}).length;
              const total = livingPlayerNames.length;
              content = isZh
                ? `✓ ${actingName} 完成了個人目標：${obj.text}（${done}/${total}）`
                : `✓ ${actingName} completed their part: ${obj.text} (${done}/${total})`;
            } else {
              content = isZh ? `✓ 目標達成：${obj.text}` : `✓ Objective complete: ${obj.text}`;
            }
            await supabase.from("story_logs").insert({
              room_id: roomId,
              round_number: room.current_round,
              entry_type: "system",
              content,
            });
          }
        }

        // 4. Pure-code ending decision: all REQUIRED objectives flagged done.
        if (allRequiredDone(objectives, progress)) {
          const victory = await generateVictoryNarration(
            scenario?.title ?? "the adventure",
            objectives,
            storyLogSoFar,
            scenario?.language ?? null
          );
          ending = { triggered: true, type: victory.type, title: victory.title, summary: victory.summary };
        }
      } else {
        // No checklist could be built — fall back to legacy free-text detection.
        ending = await detectEnding(
          scenario.ending_conditions,
          storyLogSoFar,
          actionText,
          gmResponse.narration,
          scenario?.language ?? null
        );
      }
    }

    // === FAILURE CONDITIONS — auto-trigger a failure ending ===
    // Checked every turn (unless the game already ended this turn or the party
    // is wiped). A strict per-turn judge confirms the failure event actually
    // happened; if so, the game ends in defeat.
    if (!ending.triggered && !allDead && scenario?.failure_conditions) {
      const failed = await checkFailureTriggered(
        scenario.failure_conditions,
        storyLogSoFar,
        actionText,
        actingName,
        gmResponse.narration
      );
      if (failed) {
        const fail = await generateFailureNarration(
          scenario?.title ?? "the adventure",
          failed,
          storyLogSoFar,
          scenario?.language ?? null
        );
        ending = { triggered: true, type: fail.type, title: fail.title, summary: fail.summary };
      }
    }

    if (ending.triggered) {
      // Log the ending as a system entry visible in the story
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `⚑ THE END — ${ending.title ?? "Adventure Complete"}`,
      });

      // Mark room as completed with ending metadata
      await supabase.from("rooms").update({
        status: "completed",
        ending_type: ending.type,
        ending_title: ending.title,
        ending_summary: ending.summary,
      }).eq("id", roomId);

      return NextResponse.json({
        response: gmResponse.narration,
        gameEnded: true,
        ending: {
          type: ending.type,
          title: ending.title,
          summary: ending.summary,
        },
      });
    }

    // No ending triggered — update choices for next player as normal
    await supabase.from("rooms").update({
      current_choices: gmResponse.choices,
      current_choices_for_player_id: nextPlayerId,
    }).eq("id", roomId);

    return NextResponse.json({
      response: gmResponse.narration,
      choices: gmResponse.choices,
      choicesForPlayerId: nextPlayerId,
      gameEnded: false,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
