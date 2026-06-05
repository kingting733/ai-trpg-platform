import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput, ScenarioGMContext } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";
import { resolveAction } from "@/lib/game/resolution";
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
    .select("*, scenarios(title, background, objective, rules, opening_scene, scene_flow, secret_rules, locations, npcs, clues, threats, traps, key_items, winning_targets, each_player_targets, failure_conditions, ending_conditions, gm_notes, source_document, language)")
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

  // === DICE RESOLUTION ===
  // The SYSTEM decides the outcome; the GM only narrates it.
  const roll = resolvedActor
    ? resolveAction(actionText, resolvedActor)
    : null;

  let actorDied = false;
  let actorBroke = false;
  if (roll && resolvedActor && roll.requires_check && (roll.hp_change !== 0 || roll.san_change !== 0)) {
    const newHp = Math.max(0, resolvedActor.hp + roll.hp_change);
    const newSan = Math.max(0, resolvedActor.san + roll.san_change);
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

  // Advance turn — skip characters who are down (HP<=0). nextActor = now-active character.
  const isDown = (c: any) => c.hp <= 0;
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

  // Fetch recent story log for GM context
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(20);

  const storyLogSoFar = (logs ?? [])
    .reverse()
    .map((l: any) => {
      if (l.entry_type === "action") return `${l.characters?.name}: ${l.content}`;
      if (l.entry_type === "gm_response") return `GM: ${l.content}`;
      return l.content;
    });

  const partyForAI = sortedByDex.map((c: any) => ({
    name: c.name,
    playerName: c.users?.username ?? null,
    background: c.background ?? null,
    dex: c.dex, hp: c.hp, san: c.san, mp: c.mp ?? 0,
    str: c.str, con: c.con, siz: c.siz, app: c.app,
    int: c.int, pow: c.pow, edu: c.edu, luck: c.luck,
  }));

  const scenario = (room as any).scenarios;
  const gmContext: ScenarioGMContext | null = scenario ? {
    openingScene: scenario.opening_scene ?? null,
    sceneFlow: scenario.scene_flow ?? null,
    secretRules: scenario.secret_rules ?? null,
    locations: Array.isArray(scenario.locations) ? scenario.locations : [],
    npcs: Array.isArray(scenario.npcs) ? scenario.npcs : [],
    clues: Array.isArray(scenario.clues) ? scenario.clues : [],
    threats: Array.isArray(scenario.threats) ? scenario.threats : [],
    traps: Array.isArray(scenario.traps) ? scenario.traps : [],
    keyItems: Array.isArray(scenario.key_items) ? scenario.key_items : [],
    winningTargets: scenario.winning_targets ?? null,
    eachPlayerTargets: scenario.each_player_targets ?? null,
    failureConditions: scenario.failure_conditions ?? null,
    endingConditions: scenario.ending_conditions ?? null,
    gmNotes: scenario.gm_notes ?? null,
    sourceDocument: scenario.source_document ?? null,
  } : null;

  const input: GMAIInput = {
    scenarioTitle: scenario?.title ?? "Unknown Scenario",
    scenarioBackground: scenario?.background ?? null,
    scenarioObjective: scenario?.objective ?? null,
    scenarioRules: scenario?.rules ?? null,
    scenarioLanguage: scenario?.language ?? null,
    scenarioGMContext: gmContext,
    characters: partyForAI,
    storyLogSoFar,
    currentRound: room.current_round,
    actingCharacterName: resolvedActor?.name ?? "Unknown",
    nextCharacterName: nextActor?.name ?? "Unknown",
    playerAction: actionText,
    resolution: roll
      ? {
          requiresCheck: roll.requires_check,
          statUsed: roll.stat_used,
          d20: roll.d20_roll,
          modifier: roll.modifier,
          dc: roll.dc,
          total: roll.total,
          outcome: roll.outcome,
          consequenceSummary: roll.consequence_summary,
          hpChange: roll.hp_change,
          sanChange: roll.san_change,
          actorDied,
          actorBroke,
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

    // === ENDING DETECTION ===
    // Check 1: all party members dead → forced failure ending (pure code).
    const allDead = sortedByDex.every((c: any) => c.hp <= 0);

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
