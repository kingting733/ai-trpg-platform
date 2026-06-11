import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput, ScenarioGMContext, LedgerEntry, LocationEntry, NpcEntry } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAction, rollInjuryDamage, rollFirstAidHeal, InjurySeverity,
  detectAttackType, resolveAttack, dodgeValueOf, NPC_DEFAULT_DODGE, AttackResult,
} from "@/lib/game/resolution";
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
import {
  coerceLocationGraph,
  coerceLocationState,
  detectTravelTarget,
  looksLikeTravel,
  matchEvidence,
  applyDiscovers,
  evaluateUnlocks,
  buildLocationBlock,
  locationShortName,
  type TravelDirective,
} from "@/lib/game/locations";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    roomId: string;
    actionText: string;
    actingUserId: string;
    characterId: string;
    forcedSkill?: string | null;
  };
  const { roomId, actionText, actingUserId, characterId, forcedSkill } = body;

  // Verify caller is a room participant and it's actually their turn
  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules, opening_scene, locations, npcs, winning_targets, each_player_targets, failure_conditions, failure_turn_limit, ending_conditions, gm_notes, source_document, language, location_graph)")
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
  //
  // CONTESTED ATTACK takes priority: when the action is an attack (STR/搏鬥 verb)
  // aimed at an identifiable combatant (player OR npc), the attacker rolls to hit,
  // the defender rolls 閃避, and the server rolls & applies damage to the TARGET.
  // Otherwise we fall back to the normal solo action check (which resolves the
  // ACTOR's own STR/搏鬥/skill roll and any self-consequences + SAN check).

  // NPC roster known to the room (declared in the scenario + any already damaged).
  const scenarioNpcs: Array<{ name: string; hp?: number }> = Array.isArray((room as any).scenarios?.npcs)
    ? (room as any).scenarios.npcs.filter((n: any) => n && typeof n === "object" && typeof n.name === "string")
    : [];
  const npcStateNow: Record<string, { hp: number; max_hp: number; alive: boolean }> =
    (room.npc_states && typeof room.npc_states === "object") ? room.npc_states : {};

  let roll = null as ReturnType<typeof resolveAction> | null;
  let attack: AttackResult | null = null;
  let actorDied = false;
  let actorBroke = false;

  // Pieces produced by an attack that must be written AFTER the action log row.
  let attackSystemLog: string | null = null;
  const attackLedgerEntries: LedgerEntry[] = [];

  const attackType = resolvedActor ? detectAttackType(actionText) : null;

  // Find an attack target named in the action: a living roster character (not self)
  // first, otherwise a known living NPC.
  let targetChar: any = null;
  let targetNpcName: string | null = null;
  if (attackType && resolvedActor) {
    targetChar = sortedByDex.find(
      (c: any) => c.id !== resolvedActor.id && c.hp > 0 && c.san > 0 && actionText.includes(c.name)
    ) ?? null;
    if (!targetChar) {
      const knownNpcNames = Array.from(new Set([
        ...Object.keys(npcStateNow),
        ...scenarioNpcs.map((n) => n.name),
      ]));
      targetNpcName = knownNpcNames.find(
        (name) => actionText.includes(name) && (npcStateNow[name]?.alive !== false)
      ) ?? null;
    }
  }

  if (attackType && resolvedActor && (targetChar || targetNpcName)) {
    // ── Contested attack path ──
    const isNpc = !targetChar;
    const targetName: string = isNpc ? (targetNpcName as string) : targetChar.name;
    const dodgeVal = isNpc ? NPC_DEFAULT_DODGE : dodgeValueOf(targetChar);
    attack = resolveAttack(resolvedActor, dodgeVal, attackType, targetName, isNpc);

    if (attack.damage > 0) {
      if (isNpc) {
        const npcStates = { ...npcStateNow };
        let npc = npcStates[targetName];
        if (!npc) {
          const declared = scenarioNpcs.find((n) => n.name === targetName);
          const maxHp = declared && typeof declared.hp === "number"
            ? declared.hp : 10;
          npc = { hp: maxHp, max_hp: maxHp, alive: true };
        }
        npc = { ...npc, hp: Math.max(0, npc.hp - attack.damage) };
        if (npc.hp <= 0) npc.alive = false;
        npcStates[targetName] = npc;
        await supabase.from("rooms").update({ npc_states: npcStates }).eq("id", roomId);
        attack.target_hp_after = npc.hp;
        attack.target_died = !npc.alive;
        attackSystemLog = npc.alive
          ? `💢 ${targetName} 被 ${resolvedActor.name} 的${attack.skill_label}攻擊命中（−${attack.damage} HP，剩餘 ${npc.hp}/${npc.max_hp}）`
          : `☠ ${targetName} 被 ${resolvedActor.name} 擊倒，已死亡。`;
        attackLedgerEntries.push({
          turn: room.current_round, type: npc.alive ? "event" : "death", character: targetName,
          fact: npc.alive
            ? `被 ${resolvedActor.name} 攻擊（${attack.skill_label}，−${attack.damage} HP）`
            : `被 ${resolvedActor.name} 擊殺`,
        });
      } else {
        const newHp = Math.max(0, targetChar.hp - attack.damage);
        await supabase.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
        targetChar.hp = newHp; // keep roster in sync for turn-advance & all-dead checks
        attack.target_hp_after = newHp;
        attack.target_died = newHp <= 0;
        attackSystemLog = newHp > 0
          ? `💢 ${targetName} 被 ${resolvedActor.name} 的${attack.skill_label}攻擊命中（−${attack.damage} HP，剩餘 ${newHp}）`
          : `☠ ${targetName} 被 ${resolvedActor.name} 擊倒。`;
        attackLedgerEntries.push({
          turn: room.current_round, type: newHp <= 0 ? "death" : "event", character: targetName,
          fact: newHp <= 0
            ? `被 ${resolvedActor.name} 擊倒陣亡`
            : `被 ${resolvedActor.name} 攻擊（${attack.skill_label}，−${attack.damage} HP）`,
        });
      }
    } else {
      // Missed or dodged — no damage.
      attackSystemLog = attack.dodged
        ? `🌀 ${attack.target_name} 閃避了 ${resolvedActor.name} 的攻擊。`
        : `✖ ${resolvedActor.name} 的攻擊落空。`;
    }

    // Build a RollResult so the existing dice UI shows the attacker's to-hit roll,
    // with the dodge + damage detail attached under `attack`.
    const hitLabel = !attack.hit
      ? "攻擊失手"
      : attack.crit
      ? `重擊命中 ${attack.target_name}（無法閃避），造成 ${attack.damage} 點傷害`
      : attack.dodged
      ? `命中判定成功，但被 ${attack.target_name} 閃避`
      : `命中 ${attack.target_name}，造成 ${attack.damage} 點傷害`;
    roll = {
      requires_check: true,
      stat_used: attack.skill_label,
      target: attack.attack_target,
      d100_roll: attack.attack_roll,
      outcome: attack.attack_outcome,
      hp_change: 0,
      san_change: 0,
      consequence_summary: hitLabel,
      san_check: null,
      attack,
    };
  } else {
    // ── Normal solo action check ──
    roll = resolvedActor ? resolveAction(actionText, resolvedActor, sceneContext, forcedSkill) : null;

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

  // Contested-attack damage feedback (written after the action so it reads in order).
  if (attackSystemLog) {
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "system",
      content: attackSystemLog,
    });
  }

  // === KEY LOCATION MEDIA REVEAL ===
  // When a player SUCCEEDS a search check at a key location that the creator
  // attached an image and/or hidden text to, push that reveal into the log —
  // once per location per room (subsequent searches don't re-trigger it).
  {
    const searchSucceeded =
      !!roll?.requires_check &&
      (roll.outcome === "success" || roll.outcome === "critical_success");
    const SEARCH_RE = /搜|調查|檢查|查看|探索|翻找|偵查|察看|search|investigate|examin|inspect|look|explor/i;
    const looksLikeSearch = SEARCH_RE.test(actionText);

    if (searchSucceeded && looksLikeSearch) {
      const locs: LocationEntry[] = Array.isArray((room as any).scenarios?.locations)
        ? (room as any).scenarios.locations.filter(
            (l: any) => l && typeof l === "object" && typeof l.name === "string"
          )
        : [];
      const alreadyRevealed: string[] = Array.isArray((room as any).revealed_locations)
        ? (room as any).revealed_locations
        : [];

      // Location "name" fields are often full scene DESCRIPTIONS (the scenario
      // format encourages vivid multi-sentence names), so requiring the action
      // text to contain the whole name almost never matched. Instead, score each
      // location by the longest contiguous overlap between the action text and
      // the location's short name (text before the first punctuation), and accept
      // the best location whose overlap is long enough to be meaningful.
      const shortName = (name: string) =>
        name.trim().split(/[：:，,。．\.\n——–\-（(【\[]/)[0].trim().slice(0, 30);
      // Break a place name into noun segments: 「百年大宅深處的書房」 →
      // ["百年大宅深處","書房"]. The action mentions the place if it contains
      // ANY segment (CJK segments ≥2 chars; latin words ≥4 letters).
      const nameSegments = (sn: string): string[] =>
        sn
          .split(/[的之\s、與和及]+/)
          .map((t) => t.trim())
          .filter((t) => (/^[\x00-\x7F]+$/.test(t) ? t.length >= 4 : t.length >= 2));

      const actionLower = actionText.toLowerCase();
      let hit: LocationEntry | null = null;
      let hitScore = 0;
      for (const l of locs) {
        const hasMedia = (l.reveal_image && l.reveal_image.trim()) || (l.reveal_text && l.reveal_text.trim());
        if (!hasMedia || alreadyRevealed.includes(l.name.trim())) continue;
        const sn = shortName(l.name);
        if (!sn) continue;
        // Exact short-name hit scores highest; otherwise the longest matched
        // segment wins. Best-scoring location across all candidates is revealed.
        let score = 0;
        if (actionLower.includes(sn.toLowerCase())) score = sn.length + 100;
        else {
          for (const seg of nameSegments(sn)) {
            if (actionLower.includes(seg.toLowerCase()) && seg.length > score) score = seg.length;
          }
        }
        if (score > 0 && score > hitScore) {
          hit = l;
          hitScore = score;
        }
      }

      if (hit) {
        const name = hit.name.trim();
        const displayName = shortName(hit.name);
        const body = hit.reveal_text?.trim();
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "location_media",
          content: body && body.length > 0 ? body : `🔍 你在「${displayName}」搜索到了一些東西。`,
          media_url: hit.reveal_image?.trim() || null,
        });
        await supabase
          .from("rooms")
          .update({ revealed_locations: [...alreadyRevealed, name] })
          .eq("id", roomId);
      }
    }
  }

  // === LOCATION SYSTEM (server-authoritative) ===
  // Optional per scenario. The server owns travel, evidence, and unlock state;
  // the AI GM is only given the resulting facts plus narration directives.
  const locationGraph = coerceLocationGraph((room as any).scenarios?.location_graph);
  let locState = locationGraph ? coerceLocationState(room.location_state, locationGraph) : null;
  let travelDirective: TravelDirective | null = null;
  let locationProgress = false;
  const locationLedgerEntries: LedgerEntry[] = [];

  if (locationGraph && locState) {
    // 1. TRAVEL — only when the action reads like movement, so merely
    //    mentioning another place (e.g. comparing notes) doesn't teleport.
    if (looksLikeTravel(actionText)) {
      const target = detectTravelTarget(actionText, locationGraph, locState);
      if (target) {
        if (target.status === "unlocked") {
          const firstVisit = !locState.visited.includes(target.node.id);
          locState.current = target.node.id;
          if (firstVisit) {
            locState.visited.push(target.node.id);
            locState.entered_round[target.node.id] = room.current_round;
            const discovered = applyDiscovers(locationGraph, locState, target.node.id);
            for (const d of discovered) {
              await supabase.from("story_logs").insert({
                room_id: roomId,
                round_number: room.current_round,
                entry_type: "system",
                content: `🧭 得知新地點：${locationShortName(d.name)}`,
              });
            }
          }
          travelDirective = { kind: "arrived", node: target.node, firstVisit };
          locationProgress = true;
          await supabase.from("story_logs").insert({
            room_id: roomId,
            round_number: room.current_round,
            entry_type: "system",
            content: `📍 隊伍前往：${locationShortName(target.node.name)}`,
          });
        } else if (target.status === "discovered") {
          travelDirective = { kind: "soft_wall", node: target.node };
        } else {
          travelDirective = { kind: "unknown_place", node: target.node };
        }
      } else {
        // Player seems to be moving but no graph node matched — place is not
        // part of this scenario's location list at all.
        travelDirective = { kind: "off_graph" };
      }
    }

    // 2. EVIDENCE — a successful search at the current location can award a
    //    defined evidence piece (named in the action, or the only one left).
    const searchOk =
      !!roll?.requires_check &&
      (roll.outcome === "success" || roll.outcome === "critical_success") &&
      /搜|調查|檢查|查看|探索|翻找|偵查|察看|閱|讀|search|investigate|examin|inspect|look|explor|read/i.test(actionText);
    if (searchOk) {
      const ev = matchEvidence(actionText, locationGraph, locState);
      if (ev) {
        locState.evidence_found.push(ev.id);
        locationProgress = true;
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "system",
          content: `🔎 取得證物：${ev.name}`,
        });
        locationLedgerEntries.push({
          turn: room.current_round,
          type: "clue",
          character: resolvedActor?.name ?? "Unknown",
          fact: `取得證物「${ev.name}」`,
        });
      }
    }

    // 3. UNLOCKS — pure-code re-evaluation of every gated node.
    const changes = evaluateUnlocks(locationGraph, locState, room.current_round);
    for (const n of changes.unlocked) {
      locationProgress = true;
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `🗺 新地點解鎖：${locationShortName(n.name)}`,
      });
      locationLedgerEntries.push({
        turn: room.current_round,
        type: "event",
        character: resolvedActor?.name ?? "Unknown",
        fact: `解鎖新地點「${locationShortName(n.name)}」`,
      });
    }

    // 4. STUCK VALVE — count turns without progress; surface the location's
    //    hint via the GM directive after 3 stalled turns.
    locState.stuck_counter = locationProgress ? 0 : locState.stuck_counter + 1;
  }

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

  // Clear old choices immediately (and persist location state if active)
  await supabase.from("rooms").update({
    current_turn_player_id: nextPlayerId,
    current_round: nextRound,
    current_choices: [],
    current_choices_for_player_id: null,
    ...(locationGraph && locState ? { location_state: locState } : {}),
  }).eq("id", roomId);

  if (nextRound !== room.current_round) {
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: nextRound,
      entry_type: "system",
      content: `--- Round ${nextRound} begins ---`,
    });
  }

  // Fetch enough entries to cover several full rounds of narration. We fetch
  // more than we need so that after filtering to narrative-only entries we
  // still have a rich recent history. System entries (dice results, HP changes,
  // round markers, location media) are excluded — the GM only needs the
  // story narrative, not mechanical bookkeeping noise.
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(40);

  const storyLogSoFar = (logs ?? [])
    .reverse()
    .filter((l: any) => l.entry_type === "action" || l.entry_type === "gm_response")
    .slice(-16)
    .map((l: any) => {
      if (l.entry_type === "action") return `[${l.characters?.name ?? "Player"}]: ${l.content}`;
      return `[GM]: ${l.content}`;
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
  // Social immunity check — runs after structuredNpcs is available.
  // Detect if the resolved action was a social skill aimed at a social-immune NPC,
  // and if so void any mechanical rewards + mark it for the GM directive.
  {
    const SOCIAL_SKILLS = new Set(["魅惑", "說服", "話術", "恐嚇", "心理學",
      "charm", "persuade", "fast_talk", "intimidate", "psychology"]);
    if (roll?.requires_check && roll.stat_used && SOCIAL_SKILLS.has(roll.stat_used)) {
      const immuneNpc = structuredNpcs.find(
        (n) => n.social_immune && n.name.trim().length > 0 && actionText.includes(n.name.trim())
      );
      if (immuneNpc) {
        roll = {
          ...roll,
          hp_change: 0,
          san_change: 0,
          outcome: "failure",
          consequence_summary: `${immuneNpc.name} 對社交技能免疫，此行動無效。`,
          _socialImmuneTarget: immuneNpc.name,
        } as typeof roll & { _socialImmuneTarget?: string };
      }
    }
  }

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

  const updatedLedger = [...storyLedger, ...newLedgerEntries, ...attackLedgerEntries, ...locationLedgerEntries];

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

  // Location directive — authoritative state + travel/stuck narration orders.
  const locationDirective =
    locationGraph && locState
      ? buildLocationBlock(
          locationGraph,
          locState,
          travelDirective,
          locState.stuck_counter >= 3
            ? locationGraph.nodes.find((n) => n.id === locState!.current)?.stuck_hint || null
            : null
        )
      : null;

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
    locationDirective,
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
          attack: attack
            ? {
                attackerName: resolvedActor?.name ?? "Unknown",
                targetName: attack.target_name,
                isNpc: attack.is_npc,
                skillLabel: attack.skill_label,
                hit: attack.hit,
                crit: attack.crit,
                dodged: attack.dodged,
                damage: attack.damage,
                targetDied: attack.target_died ?? false,
              }
            : null,
          socialImmune: (roll as any)?._socialImmuneTarget
            ? { targetName: (roll as any)._socialImmuneTarget as string }
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

    // Persist the next player's choices IMMEDIATELY — before the (potentially
    // slow) objective/ending/failure detection calls below. Otherwise, if any of
    // those AI calls runs long or the function times out, the narration would be
    // saved with no choices, leaving the next player stuck. If an ending IS later
    // triggered, the early-return paths below overwrite room status to completed,
    // and the UI hides choices for a finished game, so writing them now is safe.
    await supabase.from("rooms").update({
      current_choices: gmResponse.choices,
      current_choices_for_player_id: nextPlayerId,
    }).eq("id", roomId);

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
    const LEDGER_STORE_LIMIT = 50;
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
