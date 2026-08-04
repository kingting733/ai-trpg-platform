import { NextResponse } from "next/server";
import { generateGMResponseStreaming, sanitizeChoicesWithMeta, GMAIInput, ScenarioGMContext, LedgerEntry, NpcEntry } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveAction, rollInjuryDamage, rollFirstAidHeal, InjurySeverity,
  resolveAttack, dodgeValueOf, NPC_DEFAULT_DODGE, AttackResult,
  detectAttackTypeForTargets, resolveFuzzyNpcTarget, resolveSanCheck,
  PLAYER_SKILL_LIST,
} from "@/lib/game/resolution";
import { generateSceneChoices } from "@/lib/ai/scene-choices";
import { refreshStorySummary } from "@/lib/ai/summarize";
import { coerceEndings, evaluateEndings, type ScenarioEnding } from "@/lib/game/endings";
import { generateEndingNarration } from "@/lib/ai/ending-narration";
import {
  decomposeObjectives,
  checkObjectiveProgress,
  incompleteForActor,
  applyCompletions,
  Objective,
  ObjectiveProgress,
} from "@/lib/ai/objectives";
import { resolveScenarioObjectives } from "@/lib/game/objectives-def";
import {
  coerceLocationGraph,
  coerceLocationState,
  resolveTravelIntent,
  looksLikeTravel,
  matchEvidence,
  applyDiscovers,
  positionOf,
  applyActorMove,
  composeSceneChoices,
  partitionExitsByNovelty,
  computeExits,
  eligibleCombatTargets,
  type SceneContext,
  evaluateUnlocks,
  evaluateEncounters,
  evaluateNpcPlacements,
  evalUnlockConditions,
  buildLocationBlock,
  locationShortName,
  resolveMoveTarget,
  type TravelDirective,
  type NpcEncounter,
} from "@/lib/game/locations";
import { type NpcRef, resolveNpc, npcStateKey, npcStateEntry, npcDisplayName } from "@/lib/game/npc";
import { mythosSpellByKey, resolveMythosCast, rollShrivellingDamage, detectMythosCastIntent, MYTHOS_MP_COST } from "@/lib/game/mythos";
import { npcAsAttacker, npcAttackType, coerceDisposition, isNpcHostile } from "@/lib/game/npc-combat";
import {
  coerceInventory,
  applyItemEvents,
  addEvidenceItem,
  buildInventoryBlock,
  type InventoryItem,
} from "@/lib/game/inventory";

export async function POST(request: Request) {
  const supabase = createClient();
  // Authoritative in-room state (character HP/SAN) is written server-side from
  // resolved dice results. After hardening, `characters` has no client UPDATE
  // policy, so those writes go through the service-role client. All values are
  // computed here from server-owned rolls; the client never supplies them.
  const admin = createAdminClient();
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
    .select("*, scenarios(title, background, objective, rules, opening_scene, npcs, objectives, winning_targets, each_player_targets, failure_conditions, failure_turn_limit, ending_conditions, gm_notes, source_document, language, location_graph, endings)")
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
  // `id` is the stable reference used by placements/encounters/endings; legacy
  // rosters without ids resolve by name (see lib/game/npc). The runtime never
  // mints ids — it only consumes persisted ones.
  const scenarioNpcs: Array<{ id?: string; name: string; hp?: number }> = Array.isArray((room as any).scenarios?.npcs)
    ? (room as any).scenarios.npcs.filter((n: any) => n && typeof n === "object" && typeof n.name === "string")
    : [];
  const npcRoster: NpcRef[] = scenarioNpcs.map((n) => ({ id: n.id, name: n.name }));
  let npcStateNow: Record<string, { hp: number; max_hp: number; alive: boolean; stance?: "hostile" | "neutral" | "friendly"; hostile?: boolean; last_attack_round?: number }> =
    (room.npc_states && typeof room.npc_states === "object") ? room.npc_states : {};

  let roll = null as ReturnType<typeof resolveAction> | null;
  let attack: AttackResult | null = null;
  let actorDied = false;
  let actorBroke = false;

  // Pieces produced by an attack that must be written AFTER the action log row.
  let attackSystemLog: string | null = null;
  const attackLedgerEntries: LedgerEntry[] = [];

  // === COMBAT SCENE SNAPSHOT (split-party) ===
  // Player-initiated combat/casting must be as location-aware as the NPC
  // aggression pass: you can only target what is present at YOUR node — no
  // sniping an NPC (or teammate) standing in another room. Read-only snapshot
  // taken BEFORE this turn's travel; the location system below re-coerces and
  // mutates its own copy.
  const combatObjProgress: Record<string, { done?: boolean }> =
    room.objective_progress && typeof room.objective_progress === "object" ? room.objective_progress : {};
  const combatGraph = coerceLocationGraph((room as any).scenarios?.location_graph);
  const combatLocState = combatGraph ? coerceLocationState(room.location_state, combatGraph) : null;
  const combatActorNode = combatGraph && combatLocState && resolvedActor
    ? positionOf(combatLocState, resolvedActor.id, combatGraph)
    : null;
  const combatPlacedKeys = new Set(
    combatGraph && combatLocState && combatActorNode
      ? evaluateNpcPlacements(combatGraph, combatLocState, room.current_round, combatObjProgress, combatActorNode)
          .map((r) => npcStateKey(r, npcRoster))
      : []
  );
  const npcHasPlacement = (key: string): boolean =>
    !!combatGraph?.npc_placements.some((p) => npcStateKey(p.npc, npcRoster) === key);
  // Same presence rule as the aggression pass: placed HERE, or unplaced
  // (legacy follow-the-action NPCs). No location system → everyone is present.
  const npcPresentInScene = (ref: string): boolean => {
    if (!combatGraph || !combatLocState || !combatActorNode) return true;
    const key = npcStateKey(ref, npcRoster);
    return combatPlacedKeys.has(key) || !npcHasPlacement(key);
  };
  const charPresentInScene = (c: { id: string }): boolean => {
    if (!combatGraph || !combatLocState || !combatActorNode) return true;
    return positionOf(combatLocState, c.id, combatGraph) === combatActorNode;
  };

  // === MYTHOS CAST (禁咒) — docs/design/mythos-skills-v1.md ===
  // A mythos key in forcedSkill takes over the whole resolution: 1d4 SAN + 3 MP
  // paid even on failure, d100 vs 30+克蘇魯知識, server-applied effects. All
  // refusals happen BEFORE any cost or write, returning a plain 400 the client
  // shows to the player (the turn is not consumed).
  // Picker key wins; otherwise detect a typed cast (「對屍鬼施展萎縮術」/
  // bare name / [tag]) among the spells this actor actually owns — without
  // this, free-text casts would fall through to costless pure narration.
  const mythosSpell =
    (forcedSkill ? mythosSpellByKey(forcedSkill) : null) ??
    mythosSpellByKey(detectMythosCastIntent(actionText, resolvedActor?.mythos_skills));
  let mythosCast: Extract<ReturnType<typeof resolveMythosCast>, { ok: true }> | null = null;
  let mythosTargetName: string | null = null;
  let mythosDirective: string | null = null;
  if (mythosSpell && resolvedActor) {
    const knownSpells: string[] = Array.isArray(resolvedActor.mythos_skills) ? resolvedActor.mythos_skills : [];
    if (!knownSpells.includes(mythosSpell.key)) {
      return NextResponse.json({ error: `${resolvedActor.name} 未曾銘刻「${mythosSpell.zh}」。` }, { status: 400 });
    }
    if (mythosSpell.needsTarget) {
      // Same conservative chain as attacks: exact name → fuzzy → sole candidate.
      // 遠古印記 only ever targets a hostile; 萎縮術 targets any living NPC.
      const trackedNames = Object.keys(npcStateNow)
        .filter((k) => npcStateNow[k]?.alive !== false)
        .filter((k) => npcPresentInScene(k)) // spells reach only the actor's scene
        .filter((k) =>
          mythosSpell.effect !== "calm" ||
          isNpcHostile(npcStateNow[k], coerceDisposition((resolveNpc(npcDisplayName(k, npcRoster), scenarioNpcs) as any)?.disposition)))
        .map((k) => npcDisplayName(k, npcRoster));
      // Roster NPCs count too — including UNTRACKED disposition-hostiles for
      // 遠古印記: the aggression pass attacks from disposition alone (no state
      // entry needed), so the sign must be able to repel the same creatures
      // BEFORE their first strike, not only after they're tracked.
      const rosterNames = scenarioNpcs
        .map((n) => n.name)
        .filter((name) => npcPresentInScene(name)) // spells reach only the actor's scene
        .filter((name) => {
          const st = npcStateEntry(name, npcRoster, npcStateNow);
          if (st?.alive === false) return false;
          if (mythosSpell.effect !== "calm") return true;
          const decl: any = resolveNpc(name, scenarioNpcs);
          return isNpcHostile(st, coerceDisposition(decl?.disposition));
        });
      const candidates = Array.from(new Set([...trackedNames, ...rosterNames]));
      mythosTargetName =
        candidates.find((name) => actionText.includes(name)) ??
        resolveFuzzyNpcTarget(actionText, candidates) ??
        (candidates.length === 1 ? candidates[0] : null);
      if (!mythosTargetName) {
        return NextResponse.json({
          error: mythosSpell.effect === "calm"
            ? `「${mythosSpell.zh}」需要一個敵對的目標——此刻無物可退。`
            : `「${mythosSpell.zh}」需要指明一個目標（在行動中寫出對象名字）。`,
        }, { status: 400 });
      }
    }
    if ((resolvedActor.mp ?? 0) < MYTHOS_MP_COST) {
      return NextResponse.json({ error: `魔力不足——施展「${mythosSpell.zh}」需要 ${MYTHOS_MP_COST} 點魔力。` }, { status: 400 });
    }
    const cast = resolveMythosCast(mythosSpell, resolvedActor);
    if (!cast.ok) {
      return NextResponse.json({ error: `魔力不足——施展「${mythosSpell.zh}」需要 ${MYTHOS_MP_COST} 點魔力。` }, { status: 400 });
    }
    mythosCast = cast;
  }

  // Attack detection strips known combatant names first — an NPC called 殺人犯
  // or 刺青師傅 must not turn every mention of them into an attack (the name
  // still matters for TARGETING, which runs on the original text below).
  const combatantNames = [
    ...scenarioNpcs.map((n) => n.name),
    ...Object.keys(npcStateNow).map((k) => npcDisplayName(k, npcRoster)),
    ...sortedByDex.map((c: any) => c.name),
  ];
  const attackType = resolvedActor && !mythosCast
    ? detectAttackTypeForTargets(actionText, combatantNames)
    : null;

  // Find an attack target named in the action: a living roster character (not self)
  // first, otherwise a known living NPC.
  let targetChar: any = null;
  let targetNpcName: string | null = null;
  if (attackType && resolvedActor) {
    // Split-party: you can only strike someone standing in YOUR scene.
    targetChar = sortedByDex.find(
      (c: any) => c.id !== resolvedActor.id && c.hp > 0 && c.san > 0 &&
        actionText.includes(c.name) && charPresentInScene(c)
    ) ?? null;
    if (!targetChar) {
      // Match against roster display names; also any NPC already tracked in
      // state (covers GM-invented NPCs not in the roster). Split-party: only
      // NPCs present at the actor's node are attackable (same presence rule
      // as the aggression pass).
      const trackedNames = Object.keys(npcStateNow)
        .filter((k) => npcPresentInScene(k))
        .map((k) => npcDisplayName(k, npcRoster));
      const knownNpcNames = Array.from(new Set([
        ...trackedNames,
        ...scenarioNpcs.map((n) => n.name).filter((name) => npcPresentInScene(name)),
      ]));
      const livingKnown = knownNpcNames.filter(
        (name) => npcStateEntry(name, npcRoster, npcStateNow)?.alive !== false
      );
      targetNpcName = livingKnown.find((name) => actionText.includes(name)) ?? null;
      // Conservative fuzzy fallback — tolerate single-char typos / distinctive
      // partial mentions ("阿哲" for 阿澤, "reys" for Reyes). Never guesses
      // between close candidates. Runs only when the exact match above missed.
      if (!targetNpcName) {
        targetNpcName = resolveFuzzyNpcTarget(actionText, livingKnown);
      }
    }

    // Unnamed-target fallback ("attack her", "kill it", or a bare "attack"):
    // no character/NPC name was found in the text. Resolve it to the SOLE
    // unambiguous living NPC, if there is exactly one. Conservative on purpose —
    // we never guess between multiple candidates, so it can't start a fight
    // against the wrong target. Prefer NPCs already engaged in the scene
    // (tracked in state); only if none are engaged do we fall back to the
    // scenario roster, and even then only when it names a single living NPC.
    if (!targetChar && !targetNpcName) {
      const livingTracked = Object.keys(npcStateNow)
        .filter((k) => npcStateNow[k]?.alive !== false)
        .filter((k) => npcPresentInScene(k)) // never auto-target an unseen remote NPC
        .map((k) => npcDisplayName(k, npcRoster));
      let candidates = Array.from(new Set(livingTracked));
      if (candidates.length === 0) {
        candidates = Array.from(new Set(
          scenarioNpcs
            .map((n) => n.name)
            .filter((name) => npcPresentInScene(name))
            .filter((name) => npcStateEntry(name, npcRoster, npcStateNow)?.alive !== false)
        ));
      }
      if (candidates.length === 1) targetNpcName = candidates[0];
    }
  }

  if (attackType && resolvedActor && (targetChar || targetNpcName)) {
    // ── Contested attack path ──
    const isNpc = !targetChar;
    const targetName: string = isNpc ? (targetNpcName as string) : targetChar.name;
    // Defender 閃避: players use DEX/2 (or stored skill). For an NPC, use the
    // declared sheet's DEX/2 when it has one, so a nimble NPC actually evades
    // better than a sluggish one; fall back to the flat default for stat-less,
    // GM-invented NPCs.
    let dodgeVal: number;
    if (!isNpc) {
      dodgeVal = dodgeValueOf(targetChar);
    } else {
      const declaredNpc = resolveNpc(targetName, scenarioNpcs as any);
      const npcDex = declaredNpc && typeof (declaredNpc as any).dex === "number" ? (declaredNpc as any).dex : null;
      dodgeVal = npcDex != null && npcDex > 0 ? Math.floor(npcDex / 2) : NPC_DEFAULT_DODGE;
    }
    attack = resolveAttack(resolvedActor, dodgeVal, attackType, targetName, isNpc);

    if (attack.damage > 0) {
      if (isNpc) {
        const npcStates = { ...npcStateNow };
        const stateKey = npcStateKey(targetName, npcRoster);
        let npc = npcStateEntry(targetName, npcRoster, npcStates);
        if (!npc) {
          const declared = resolveNpc(targetName, scenarioNpcs);
          const maxHp = declared && typeof declared.hp === "number"
            ? declared.hp : 10;
          npc = { hp: maxHp, max_hp: maxHp, alive: true };
        }
        npc = { ...npc, hp: Math.max(0, npc.hp - attack.damage) };
        if (npc.hp <= 0) npc.alive = false;
        npcStates[stateKey] = npc;
        await supabase.from("rooms").update({ npc_states: npcStates }).eq("id", roomId);
        npcStateNow = npcStates; // keep in-memory state current for endings eval
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
        await admin.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
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
    } else if (attack.fumble && resolvedActor) {
      // 大失敗 (critical failure): the attacker botches and hurts THEMSELVES —
      // stumbles into their own strike, recoil, a slip. 1d2 self-damage.
      const selfDmg = rollInjuryDamage("minor").amount; // 1d2
      const attackerRow = sortedByDex.find((c: any) => c.id === resolvedActor.id);
      const curHp = attackerRow ? attackerRow.hp : null;
      if (attackerRow && curHp != null && curHp > 0) {
        const newHp = Math.max(0, curHp - selfDmg);
        await admin.from("characters").update({ hp: newHp }).eq("id", attackerRow.id);
        attackerRow.hp = newHp; // keep roster in sync for turn-advance & all-dead checks
        if (newHp <= 0) actorDied = true;
        attackSystemLog = newHp > 0
          ? `💥 ${resolvedActor.name} 攻擊大失敗，反傷自己（−${selfDmg} HP，剩餘 ${newHp}）。`
          : `☠ ${resolvedActor.name} 攻擊大失敗，反傷倒下。`;
        attackLedgerEntries.push({
          turn: room.current_round, type: newHp <= 0 ? "death" : "event", character: resolvedActor.name,
          fact: newHp <= 0 ? `攻擊大失敗反傷倒下` : `攻擊大失敗，反傷自己（−${selfDmg} HP）`,
        });
      } else {
        attackSystemLog = `💥 ${resolvedActor.name} 攻擊大失敗。`;
      }
    } else {
      // Missed or dodged — no damage.
      attackSystemLog = attack.dodged
        ? `🌀 ${attack.target_name} 閃避了 ${resolvedActor.name} 的攻擊。`
        : `✖ ${resolvedActor.name} 的攻擊落空。`;
    }

    // RETALIATION — attacking an NPC (hit or miss) turns it hostile, so it
    // fights back via the NPC-aggression pass below.
    if (isNpc) {
      const states = { ...npcStateNow };
      const key = npcStateKey(targetName, npcRoster);
      const existing: any = states[key] ?? npcStateEntry(targetName, npcRoster, states);
      if (existing) {
        states[key] = { ...existing, stance: "hostile" };
      } else {
        const declared = resolveNpc(targetName, scenarioNpcs);
        const maxHp = declared && typeof declared.hp === "number" ? declared.hp : 10;
        states[key] = { hp: maxHp, max_hp: maxHp, alive: true, stance: "hostile" };
      }
      npcStateNow = states;
      await supabase.from("rooms").update({ npc_states: npcStateNow }).eq("id", roomId);
    }

    // The horror SAN check stacks on top of the attack, exactly like every
    // other action — charging the monster must not be a way to DODGE the
    // scene's SAN roll.
    const attackSanCheck = resolveSanCheck(`${actionText}\n${sceneContext}`, resolvedActor);
    if (attackSanCheck && attackSanCheck.san_loss > 0) {
      const newSan = Math.max(0, resolvedActor.san - attackSanCheck.san_loss);
      actorBroke = newSan <= 0;
      await admin.from("characters").update({ san: newSan }).eq("id", resolvedActor.id);
      resolvedActor.san = newSan;
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
      san_change: 0, // attack itself costs no SAN; the horror check is separate
      consequence_summary: hitLabel,
      san_check: attackSanCheck, // rendered as its own dice box, as usual
      attack,
    };
  } else if (mythosCast && mythosSpell && resolvedActor) {
    // ── Mythos cast — costs already rolled; apply them, then the effect ──
    // The horror SAN check stacks on top of the cast price, exactly like every
    // other action (casting must not be a way to DODGE the scene's SAN roll).
    const mythosSanCheck = resolveSanCheck(`${actionText}\n${sceneContext}`, resolvedActor);
    const horrorLoss = mythosSanCheck?.san_loss ?? 0;
    const totalSanLoss = Math.min(resolvedActor.san, mythosCast.sanLoss + horrorLoss);
    const newMp = Math.max(0, (resolvedActor.mp ?? 0) - mythosCast.mpCost);
    const newSan = Math.max(0, resolvedActor.san - totalSanLoss);
    actorBroke = newSan <= 0;
    await admin.from("characters").update({ mp: newMp, san: newSan }).eq("id", resolvedActor.id);
    resolvedActor.mp = newMp;
    resolvedActor.san = newSan;

    const succeeded = mythosCast.outcome === "success" || mythosCast.outcome === "critical_success";
    const costNote = `理智 −${mythosCast.sanLoss}，魔力 −${mythosCast.mpCost}`;

    if (succeeded && mythosSpell.effect === "damage" && mythosTargetName) {
      // Shrivelling damage — same NPC-hp authority path as attacks, no dodge.
      const damage = rollShrivellingDamage(mythosCast.outcome);
      const npcStates = { ...npcStateNow };
      const stateKey = npcStateKey(mythosTargetName, npcRoster);
      let npc = npcStateEntry(mythosTargetName, npcRoster, npcStates);
      if (!npc) {
        const declared = resolveNpc(mythosTargetName, scenarioNpcs);
        const maxHp = declared && typeof declared.hp === "number" ? declared.hp : 10;
        npc = { hp: maxHp, max_hp: maxHp, alive: true };
      }
      npc = { ...npc, hp: Math.max(0, npc.hp - damage) };
      if (npc.hp <= 0) npc.alive = false;
      // Surviving victims of forbidden magic turn hostile (same as being attacked).
      if (npc.alive) (npc as any).stance = "hostile";
      npcStates[stateKey] = npc;
      await supabase.from("rooms").update({ npc_states: npcStates }).eq("id", roomId);
      npcStateNow = npcStates;
      attackSystemLog = npc.alive
        ? `🜏 ${mythosTargetName} 被 ${resolvedActor.name} 的「${mythosSpell.zh}」灼傷（−${damage} HP，剩餘 ${npc.hp}/${npc.max_hp}）`
        : `☠ ${mythosTargetName} 在「${mythosSpell.zh}」下凋萎而亡。`;
      attackLedgerEntries.push({
        turn: room.current_round, type: npc.alive ? "event" : "death", character: mythosTargetName,
        fact: npc.alive
          ? `被 ${resolvedActor.name} 的禁咒「${mythosSpell.zh}」灼傷（−${damage} HP）`
          : `被 ${resolvedActor.name} 的禁咒「${mythosSpell.zh}」殺死`,
      });
      mythosDirective = `MYTHOS SPELL (authoritative): ${resolvedActor.name} 成功施展禁咒「${mythosSpell.zh}」，${mythosTargetName} 受到 ${damage} 點傷害${npc.alive ? "" : "並已死亡"}. Narrate unnatural, withering harm — flesh desiccating, warmth draining. The mechanical outcome above is final.`;
    } else if (succeeded && mythosSpell.effect === "calm" && mythosTargetName) {
      // Elder Sign — repels even the social_immune; stance → neutral.
      const key = npcStateKey(mythosTargetName, npcRoster);
      const cur: any = npcStateNow[key] ?? npcStateEntry(mythosTargetName, npcRoster, npcStateNow) ?? { hp: 10, max_hp: 10, alive: true };
      npcStateNow = { ...npcStateNow, [key]: { ...cur, stance: "neutral" } };
      await supabase.from("rooms").update({ npc_states: npcStateNow }).eq("id", roomId);
      attackSystemLog = `🜏 ${resolvedActor.name} 舉起「${mythosSpell.zh}」，${mythosTargetName} 退避了，不再敵對。`;
      attackLedgerEntries.push({
        turn: room.current_round, type: "event", character: mythosTargetName,
        fact: `被 ${resolvedActor.name} 的「${mythosSpell.zh}」逼退，不再敵對`,
      });
      mythosDirective = `MYTHOS SPELL (authoritative): ${resolvedActor.name} 成功以「${mythosSpell.zh}」逼退 ${mythosTargetName} — it recoils from the sign and ceases hostility. Narrate its unwilling, unnatural retreat.`;
    } else if (succeeded && mythosSpell.effect === "reveal") {
      mythosDirective = `MYTHOS REVEAL (authoritative): ${resolvedActor.name} 成功施展「${mythosSpell.zh}」— the dead answer. Reveal exactly ONE true, GM-internal piece of information relevant to the CURRENT scene (a hidden truth of this place, an entry from NPC KNOWLEDGE, or the meaning of a clue already found), delivered as whispers of the dead. Do NOT invent new mechanical facts, locations, or items — only surface a truth that already exists in your briefing.`;
    } else if (mythosCast.outcome === "fumble") {
      mythosDirective = `MYTHOS BACKLASH (authoritative): ${resolvedActor.name} 施展「${mythosSpell.zh}」大失敗，禁咒反噬（額外理智損失已由系統扣除，共 −${mythosCast.sanLoss} SAN）. Narrate an EXTREME, terrifying manifestation — the magic twists back on the caster: visions, wrongness, something noticing them. Do NOT apply further mechanical harm; the system already has.`;
    } else {
      mythosDirective = `MYTHOS SPELL: ${resolvedActor.name} 施展「${mythosSpell.zh}」失敗——咒文散逸，代價仍已付出（${costNote}）. Narrate the fizzle: the words falter, the power slips away, the toll on mind and body remains.`;
    }

    const summary =
      mythosCast.outcome === "fumble"
        ? `大失敗 — 禁咒反噬！（${costNote}）`
        : succeeded
        ? mythosCast.outcome === "critical_success"
          ? `大成功 — 禁咒完美生效（${costNote}）`
          : `成功 — 禁咒生效（${costNote}）`
        : `失敗 — 咒文散逸，代價已付（${costNote}）`;
    roll = {
      requires_check: true,
      stat_used: mythosSpell.zh,
      target: mythosCast.target,
      d100_roll: mythosCast.roll,
      outcome: mythosCast.outcome === "fumble" ? "critical_failure" : mythosCast.outcome,
      hp_change: 0,
      san_change: -mythosCast.sanLoss, // informational — already applied above
      consequence_summary: summary,
      san_check: mythosSanCheck, // separate dice box, same as normal actions
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
      await admin.from("characters")
        .update({ hp: newHp, san: newSan })
        .eq("id", resolvedActor.id);
      resolvedActor.hp = newHp;
      resolvedActor.san = newSan;
    }
  }

  // Save action to story_logs, with the dice result attached to the action entry.
  // Capture its created_at: it is the FIRST story_log of this turn, so every
  // mechanical row that follows (travel, items, SAN media, unlocks) has
  // created_at >= this — the prelude query below uses it to stream the
  // mechanics to the client BEFORE the GM narration (variant B).
  const { data: actionRow } = await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: room.current_round,
    entry_type: "action",
    player_id: user.id,
    character_id: characterId,
    content: actionText,
    roll_result: roll,
  }).select("created_at").single();
  const turnStartedAt: string | null = actionRow?.created_at ?? null;

  // Contested-attack damage feedback (written after the action so it reads in order).
  if (attackSystemLog) {
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "system",
      content: attackSystemLog,
    });
  }

  // NOTE: the legacy free-text "key location" search-reveal mechanic was retired
  // with the old `locations` array. Reveal images/text now live on location-graph
  // nodes (node_image/node_text) and evidence (reveal_image/reveal_text); the
  // graph's evidence/entry handling below surfaces them to players on a search.

  // Computed early so location unlock conditions can reference objective:<id>.
  const objProgress: ObjectiveProgress =
    room.objective_progress && typeof room.objective_progress === "object" ? room.objective_progress : {};

  // === LOCATION SYSTEM (server-authoritative) ===
  // Optional per scenario. The server owns travel, evidence, and unlock state;
  // the AI GM is only given the resulting facts plus narration directives.
  const locationGraph = coerceLocationGraph((room as any).scenarios?.location_graph);
  let locState = locationGraph ? coerceLocationState(room.location_state, locationGraph) : null;
  let travelDirective: TravelDirective | null = null;
  let locationProgress = false;
  const locationLedgerEntries: LedgerEntry[] = [];
  let locationFiredEncounters: NpcEncounter[] = [];

  // SEED — on the room's very first turn there is no saved location_state, so
  // initLocationState places the party at the starting node but never runs the
  // start node's `discovers`, and its `visit:`-gated neighbours are only picked
  // up later. Apply the starting node's discoveries and evaluate unlocks NOW,
  // before the player's action, so B/C/D reveal on turn 1 even if the player's
  // first move leaves the starting node. (arrival-based discovers only fire for
  // nodes you travel INTO, never the one you start in.)
  const freshLocationState =
    !room.location_state ||
    (typeof room.location_state === "object" && Object.keys(room.location_state).length === 0);

  // SELF-HEAL positions[] — every in-room character must have an explicit entry.
  // positionOf() falls back to the legacy `current` mirror, which tracks the LAST
  // MOVER: so in a room whose state predates split-party seeding, the moment one
  // character walks away EVERY other character silently "follows" them. That made
  // the engine believe the party was together (nextActorNode === actorNode), so
  // the next player's choices were bound to the wrong scene entirely.
  // Idempotent: only fills gaps, never overwrites a real position. NOTE this
  // cannot RECOVER a legacy character's true position — that was never recorded.
  // It snapshots the same fallback positionOf() already returns, which stops the
  // ongoing drift (matching the spec's "everyone stands where the party was").
  // Persisted with the rest of locState in the room update below.
  if (locationGraph && locState) {
    let backfilled = 0;
    for (const c of sortedByDex) {
      if (!locState.positions[c.id]) {
        const resolved = positionOf(locState, c.id, locationGraph);
        if (resolved) { locState.positions[c.id] = resolved; backfilled++; }
      }
    }
    if (backfilled > 0 && !freshLocationState) {
      console.warn(`[locations] backfilled positions for ${backfilled} character(s) in room ${roomId} — legacy state without per-character positions.`);
    }
  }
  if (locationGraph && locState && freshLocationState && locState.current) {
    // Split-party: everyone spawns at the entry node (splitting is opt-in by
    // walking away). positionOf falls back to `current` anyway, but explicit
    // seeding keeps the player panel's teammates list accurate from turn 1.
    for (const c of sortedByDex) locState.positions[c.id] = locState.current;
    // Reveal the starting scene's own media (image/text) — like arrival media,
    // but the start node is never "arrived at", so it must fire here or never.
    const startNode = locationGraph.nodes.find((n) => n.id === locState!.current);
    const startImage = startNode?.node_image?.trim();
    const startText = startNode?.node_text?.trim();
    if (startImage || startText) {
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "location_media",
        content:
          startText && startText.length > 0
            ? startText
            : `📍 你身處「${locationShortName(startNode!.name)}」。`,
        media_url: startImage || null,
      });
    }
    const seededDiscovers = applyDiscovers(locationGraph, locState, locState.current);
    const seededUnlocks = evaluateUnlocks(locationGraph, locState, room.current_round, objProgress);
    // Only UNLOCKS announce (one merged line); discovered-but-locked places
    // just appear on the map panel as 🔒.
    if (seededDiscovers.length) locationProgress = true;
    if (seededUnlocks.unlocked.length) {
      locationProgress = true;
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `🗺 新地點解鎖：${seededUnlocks.unlocked.map((n) => locationShortName(n.name)).join("、")}`,
      });
    }
  }

  // Party-wide soft inventory (context for the GM; never gates progression).
  // 證物 awarded THIS turn are bridged into the bag after narration.
  let inventory: InventoryItem[] = coerceInventory((room as any).inventory);
  const evidenceAwardedThisTurn: { name: string; id: string }[] = [];

  const SEARCH_RE = /搜|調查|檢查|查看|探索|翻找|偵查|察看|閱|讀|search|investigate|examin|inspect|look|explor|read/i;
  // Search-type skills. When the player picks one of these from the skill box,
  // the action counts as a generic search for evidence purposes even if the
  // typed text is just a bare location name (no search keyword) — otherwise the
  // check passes but no 證物 is awarded (see 取得方式=搜查 clues).
  const SEARCH_SKILLS = new Set([
    "偵查", "聆聽", "圖書館使用", "追蹤", "導航", "自然學",
    "spot_hidden", "listen", "library_use", "track", "navigate", "natural_world",
  ]);

  // The action counts as a search if the typed text has a search verb OR the
  // player explicitly picked a search-type skill from the skill box.
  const isSearchAction =
    SEARCH_RE.test(actionText) || SEARCH_SKILLS.has(roll?.stat_used ?? "");

  // Split-party: everything below is relative to the ACTING character's node.
  let actorNode: string | null = null;
  if (locationGraph && locState) {
    actorNode = resolvedActor ? positionOf(locState, resolvedActor.id, locationGraph) : locState.current;
    // A search that NAMES another location should relocate the ACTOR there
    // first, then search it — players expect "偵查 B" (while in A) to search B,
    // not A. Reuses the travel machinery below; if the named place is locked,
    // the normal soft-wall/unknown directives fire and nobody moves.
    const searchElsewhere =
      !looksLikeTravel(actionText) &&
      isSearchAction &&
      resolveTravelIntent(actionText, locationGraph, locState, actorNode) != null;

    // BARE-NAME TRAVEL: typing just a location's name ("1404門口" — what the
    // click-to-fill panel produces) has no travel verb, so it used to depend on
    // the GM's probabilistic move_to (sometimes narrated a move the server
    // never made). If the action is essentially NOTHING BUT a matched location
    // name, treat it as deterministic travel. Guard: after stripping the
    // matched node's name (and any container name resolving to it) plus
    // punctuation, at most 4 chars may remain — mentioning a place mid-sentence
    // still never teleports.
    let bareNameTravel = false;
    if (!looksLikeTravel(actionText) && !searchElsewhere) {
      const probe = resolveTravelIntent(actionText, locationGraph, locState, actorNode);
      if (probe) {
        let residue = actionText;
        // Strip the matched node's name, and any container name that resolves
        // to it (typing "1404室" matches the entry node 1404門口 — both names
        // count as "just the location").
        const stripNames = [
          locationShortName(probe.node.name),
          ...locationGraph.containers
            .filter((c) => probe.node.container === c.id)
            .map((c) => locationShortName(c.name)),
        ];
        for (const nm of stripNames) {
          if (nm) residue = residue.split(nm).join("");
        }
        residue = residue.replace(/[\s，,。．.!！?？、:：;；「」『』()（）]/g, "");
        bareNameTravel = residue.length <= 4;
      }
    }

    // 1. TRAVEL — on an explicit movement verb, a search that names another
    //    location, OR a bare location name. Merely mentioning a place in
    //    passing does not teleport, because resolveTravelIntent only matches a
    //    real location name/segment (and bare-name mode requires the text to
    //    be almost nothing but the name). In map (edges) mode it also enforces
    //    adjacency: "go" only comes back for destinations reachable via open
    //    paths, container names resolve to their entry node, and hidden places
    //    never match at all.
    if (looksLikeTravel(actionText) || searchElsewhere || bareNameTravel) {
      const intent = resolveTravelIntent(actionText, locationGraph, locState, actorNode);
      if (intent) {
        if (intent.kind === "go") {
          const targetNode = intent.node;
          // Moves ONLY the actor; first visit BY ANYONE fires discovers and
          // first-visit media (shared party knowledge).
          const moved = resolvedActor
            ? applyActorMove(locationGraph, locState, resolvedActor.id, targetNode.id, room.current_round)
            : (() => { // no resolvable actor (legacy edge) — old party behavior
                const fv = !locState.visited.includes(targetNode.id);
                locState.current = targetNode.id;
                if (fv) {
                  locState.visited.push(targetNode.id);
                  locState.entered_round[targetNode.id] = room.current_round;
                  return { firstVisit: true, discovered: applyDiscovers(locationGraph, locState, targetNode.id) };
                }
                return { firstVisit: false, discovered: [] };
              })();
          actorNode = targetNode.id;
          const firstVisit = moved.firstVisit;
          // Discovered-but-locked places surface on the map panel (🔒) without
          // a log message; only real unlocks announce (see the UNLOCKS pass —
          // a discover whose conditions already hold unlocks there this turn).
          travelDirective = { kind: "arrived", node: targetNode, firstVisit };
          locationProgress = true;
          await supabase.from("story_logs").insert({
            room_id: roomId,
            round_number: room.current_round,
            entry_type: "system",
            content: `📍 ${resolvedActor?.name ?? "隊伍"} 前往：${locationShortName(targetNode.name)}`,
          });
          // First-visit node media: reveal the creator's image/text on arrival.
          if (firstVisit) {
            const nodeImage = targetNode.node_image?.trim();
            const nodeText = targetNode.node_text?.trim();
            if (nodeImage || nodeText) {
              await supabase.from("story_logs").insert({
                room_id: roomId,
                round_number: room.current_round,
                entry_type: "location_media",
                content:
                  nodeText && nodeText.length > 0
                    ? nodeText
                    : `📍 你抵達了「${locationShortName(targetNode.name)}」。`,
                media_url: nodeImage || null,
              });
            }
          }
        } else if (intent.kind === "locked") {
          travelDirective = { kind: "soft_wall", node: intent.node };
        } else if (intent.kind === "blocked") {
          // Map mode: destination is open but the route crosses a locked node.
          travelDirective = { kind: "blocked_path", node: intent.node, blocker: intent.blocker };
        } else {
          travelDirective = { kind: "unknown_place", node: intent.node };
        }
      } else {
        // Player seems to be moving but no graph node matched — place is not
        // part of this scenario's location list at all (or, in map mode, is
        // still hidden — the system won't confirm it exists).
        travelDirective = { kind: "off_graph" };
      }
    }

    // 2. EVIDENCE — a passed check can award clues at the current location. A
    //    generic search reveals search-obtainable clues; a specific action
    //    (e.g. 破壞電腦) reveals the clue whose 取得方式 it matches.
    const passedCheck =
      !!roll?.requires_check &&
      (roll.outcome === "success" || roll.outcome === "critical_success");
    if (passedCheck) {
      // Evidence lives where the ACTOR now stands (after any travel this turn).
      const found = matchEvidence(actionText, locationGraph, locState, isSearchAction, actorNode);
      for (const ev of found) {
        locState.evidence_found.push(ev.id);
        locationProgress = true;
        evidenceAwardedThisTurn.push({ name: ev.name, id: ev.id });
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "system",
          // Neutral wording (same as ordinary items) so the log doesn't reveal
          // which pickups are plot-critical 證物. The evidence system still
          // tracks it as evidence internally for unlock/ending conditions.
          content: `📦 取得物品：${ev.name}`,
        });
        // If the creator attached media to this evidence, reveal it to the
        // players immediately (the server's own award is the trigger — no fuzzy
        // name matching needed, unlike the legacy 關鍵地點 reveal above).
        const evImage = ev.reveal_image?.trim();
        const evText = ev.reveal_text?.trim();
        if (evImage || evText) {
          await supabase.from("story_logs").insert({
            room_id: roomId,
            round_number: room.current_round,
            entry_type: "location_media",
            content: evText && evText.length > 0 ? evText : `🔍 你取得了「${ev.name}」。`,
            media_url: evImage || null,
          });
        }
        locationLedgerEntries.push({
          turn: room.current_round,
          type: "clue",
          character: resolvedActor?.name ?? "Unknown",
          fact: `取得證物「${ev.name}」`,
          node: actorNode ?? undefined,
        });
      }
    }

    // 3. UNLOCKS — pure-code re-evaluation of every gated node. One merged
    //    player-visible line; the GM ledger keeps per-node facts.
    const changes = evaluateUnlocks(locationGraph, locState, room.current_round, objProgress);
    if (changes.unlocked.length) {
      locationProgress = true;
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `🗺 新地點解鎖：${changes.unlocked.map((n) => locationShortName(n.name)).join("、")}`,
      });
      for (const n of changes.unlocked) {
        locationLedgerEntries.push({
          turn: room.current_round,
          type: "event",
          character: resolvedActor?.name ?? "Unknown",
          fact: `解鎖新地點「${locationShortName(n.name)}」`,
        });
      }
    }

    // 4. NPC ENCOUNTERS — one-shot triggers that fire when conditions are met.
    locationFiredEncounters = evaluateEncounters(locationGraph, locState, room.current_round, objProgress);
    for (const enc of locationFiredEncounters) {
      locationProgress = true;
      const encNpcName = npcDisplayName(enc.npc, npcRoster);
      await supabase.from("story_logs").insert({
        room_id: roomId,
        round_number: room.current_round,
        entry_type: "system",
        content: `⚡ NPC 事件觸發：${encNpcName}`,
      });
      locationLedgerEntries.push({
        turn: room.current_round,
        type: "event",
        character: encNpcName,
        fact: `觸發 NPC 事件（${enc.beat.slice(0, 60)}）`,
      });
    }

    // 5. STUCK VALVE — count turns without progress; surface the location's
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
        await admin.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
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

  // === SOCIAL DE-ESCALATION (pacify) ===
  // A passed 說服 / 魅惑 / 心理學 against a currently-hostile, non-immune NPC calms
  // it (stance → neutral) so it stops attacking. Resolved BEFORE the aggression
  // pass so a talked-down NPC does not also swing this same turn.
  const PACIFY_SKILLS = ["說服", "魅惑", "心理學"];
  if (
    resolvedActor &&
    roll?.requires_check &&
    (roll.outcome === "success" || roll.outcome === "critical_success") &&
    PACIFY_SKILLS.includes(roll.stat_used ?? "")
  ) {
    // Candidates: tracked hostiles PLUS untracked roster NPCs whose effective
    // stance is hostile — a disposition-hostile NPC that hasn't struck yet (no
    // state entry) must still be talk-down-able, or a PASSED 說服 silently does
    // nothing while the GM narrates success (state/narration divergence).
    // Scene-filtered: you can only talk down what is present at your node.
    const hostileRefSet = new Map<string, string>(); // canonical key → ref
    for (const ref of [...Object.keys(npcStateNow), ...scenarioNpcs.map((n) => n.name)]) {
      const key = npcStateKey(ref, npcRoster);
      if (!hostileRefSet.has(key)) hostileRefSet.set(key, ref);
    }
    const hostileRefs = Array.from(hostileRefSet.values()).filter((k) => {
      if (!npcPresentInScene(k)) return false;
      const decl: any = resolveNpc(k, scenarioNpcs);
      if (decl?.social_immune) return false; // mindless/immune: cannot be talked down
      const st = npcStateEntry(k, npcRoster, npcStateNow);
      return isNpcHostile(st, coerceDisposition(decl?.disposition)) && st?.alive !== false;
    });
    // Calm a hostile NPC named in the action (exact/fuzzy), else the sole one.
    let calmRef: string | null =
      hostileRefs.find((k) => actionText.includes(npcDisplayName(k, npcRoster))) ?? null;
    if (!calmRef) {
      const fuzzy = resolveFuzzyNpcTarget(actionText, hostileRefs.map((k) => npcDisplayName(k, npcRoster)));
      if (fuzzy) calmRef = hostileRefs.find((k) => npcDisplayName(k, npcRoster) === fuzzy) ?? null;
    }
    if (!calmRef && hostileRefs.length === 1) calmRef = hostileRefs[0];
    if (calmRef) {
      const key = npcStateKey(calmRef, npcRoster);
      const cur: any = npcStateNow[key] ?? npcStateEntry(calmRef, npcRoster, npcStateNow) ?? { hp: 10, max_hp: 10, alive: true };
      npcStateNow = { ...npcStateNow, [key]: { ...cur, stance: "neutral" } };
      await supabase.from("rooms").update({ npc_states: npcStateNow }).eq("id", roomId);
      await supabase.from("story_logs").insert({
        room_id: roomId, round_number: room.current_round, entry_type: "system",
        content: `🕊 ${npcDisplayName(calmRef, npcRoster)} 被安撫下來，不再敵對。`,
      });
    }
  }

  // === NPC AGGRESSION (server-authoritative) ===
  // Hostile NPCs present in the scene attack a player ONCE per round, using the
  // same resolveAttack machinery players use (to-hit vs 閃避, damage + STR/SIZ
  // bonus, crit, fumble). The GM only narrates the outcomes computed here.
  const npcActionLines: string[] = [];
  if (resolvedActor) {
    // Split-party: the narrated scene is the ACTOR's node. Placed NPCs count as
    // present only if placed THERE; tracked-but-unplaced NPCs keep the legacy
    // behavior (they follow the action). Placed hostiles elsewhere hold still —
    // their scene isn't being narrated this turn.
    const placedNames = locationGraph && locState
      ? evaluateNpcPlacements(locationGraph, locState, room.current_round, objProgress, actorNode)
      : [];
    const placedKeys = new Set(placedNames.map((r) => npcStateKey(r, npcRoster)));
    const hasPlacementFor = (key: string): boolean =>
      !!locationGraph?.npc_placements.some((p) => npcStateKey(p.npc, npcRoster) === key);
    const trackedRefs = Object.keys(npcStateNow).filter(
      (k) => placedKeys.has(k) || !hasPlacementFor(k)
    );
    const sceneRefs = Array.from(new Set([...placedNames, ...trackedRefs]));

    const states: Record<string, any> = { ...npcStateNow };
    let statesChanged = false;
    const MAX_NPC_ATTACKS = 3; // bound a big mob scene in a single turn
    let attacksDone = 0;

    for (const ref of sceneRefs) {
      if (attacksDone >= MAX_NPC_ATTACKS) break;
      const key = npcStateKey(ref, npcRoster);
      const st: any = states[key] ?? npcStateEntry(ref, npcRoster, states);
      const declared: any = resolveNpc(ref, scenarioNpcs);
      const disposition = coerceDisposition(declared?.disposition);
      const alive = st?.alive !== false;
      const hostile = isNpcHostile(st, disposition); // stance override → legacy → disposition
      const lastRound = st?.last_attack_round ?? -1;
      if (!alive || !hostile || lastRound >= room.current_round) continue;

      // Target: co-located characters only (solo-combat rule — being alone in
      // the scene means facing it alone). Prefer the acting player.
      let living = sortedByDex.filter((c: any) => c.hp > 0 && c.san > 0);
      if (locationGraph && locState && actorNode) {
        living = eligibleCombatTargets(living, locState, actorNode, locationGraph)
          .filter((c: any) => c.san > 0);
      }
      if (living.length === 0) break;
      const target =
        living.find((c: any) => c.id === resolvedActor.id) ??
        living[Math.floor(Math.random() * living.length)];

      const maxHp = st?.max_hp ?? (typeof declared?.hp === "number" ? declared.hp : 10);
      const curNpc = st ?? { hp: maxHp, max_hp: maxHp, alive: true };
      const npcName = npcDisplayName(ref, npcRoster);
      const profile = {
        str: declared?.str, siz: declared?.siz, dex: declared?.dex,
        skills: declared?.skills ?? null, armed: declared?.armed === true,
      };
      const result = resolveAttack(
        npcAsAttacker(profile), dodgeValueOf(target), npcAttackType(profile), target.name, false,
      );

      let logLine: string;
      if (result.damage > 0) {
        const newHp = Math.max(0, target.hp - result.damage);
        await admin.from("characters").update({ hp: newHp }).eq("id", target.id);
        target.hp = newHp; // keep roster in sync for turn-advance & all-dead checks
        logLine = newHp > 0
          ? `💢 ${target.name} 被 ${npcName} 的${result.skill_label}攻擊命中（−${result.damage} HP，剩餘 ${newHp}）`
          : `☠ ${target.name} 被 ${npcName} 擊倒。`;
        npcActionLines.push(`${npcName} attacked ${target.name} and HIT for ${result.damage} damage${newHp <= 0 ? ` — ${target.name} is DOWN` : ""}.`);
        attackLedgerEntries.push({
          turn: room.current_round, type: newHp <= 0 ? "death" : "event", character: target.name,
          fact: newHp <= 0 ? `被 ${npcName} 擊倒` : `被 ${npcName} 攻擊（−${result.damage} HP）`,
        });
        states[key] = { ...curNpc, stance: "hostile", last_attack_round: room.current_round };
      } else if (result.fumble) {
        const selfDmg = rollInjuryDamage("minor").amount; // 1d2
        const nHp = Math.max(0, curNpc.hp - selfDmg);
        states[key] = { ...curNpc, hp: nHp, alive: nHp > 0, stance: "hostile", last_attack_round: room.current_round };
        logLine = `💥 ${npcName} 攻擊大失敗，反傷自己（−${selfDmg} HP）。`;
        npcActionLines.push(`${npcName} fumbled its attack and hurt itself.`);
      } else {
        logLine = result.dodged
          ? `🌀 ${target.name} 閃避了 ${npcName} 的攻擊。`
          : `✖ ${npcName} 的攻擊落空。`;
        npcActionLines.push(result.dodged
          ? `${npcName} attacked ${target.name}, who DODGED.`
          : `${npcName} attacked ${target.name} but MISSED.`);
        states[key] = { ...curNpc, stance: "hostile", last_attack_round: room.current_round };
      }

      statesChanged = true;
      attacksDone++;
      await supabase.from("story_logs").insert({
        room_id: roomId, round_number: room.current_round, entry_type: "system", content: logLine,
      });
    }

    if (statesChanged) {
      npcStateNow = states;
      await supabase.from("rooms").update({ npc_states: npcStateNow }).eq("id", roomId);
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

  const narrativeLogs = (logs ?? [])
    .reverse()
    .filter((l: any) => l.entry_type === "action" || l.entry_type === "gm_response");
  const fmtLog = (l: any) =>
    l.entry_type === "action" ? `[${l.characters?.name ?? "Player"}]: ${l.content}` : `[GM]: ${l.content}`;
  const storyLogSoFar = narrativeLogs.slice(-16).map(fmtLog);

  // Split-party continuity guarantee: with 5+ players (or long narrations) the
  // acting character's own previous turn can slide out of the prompt's RECENT
  // TURNS window while OTHER scenes fill it. If so, pass their last
  // action+narration pair separately so the GM always remembers what THIS
  // character was doing. (The very last narrative entry is THIS turn's action —
  // search starts before it.)
  let actorLastScene: string | null = null;
  if (resolvedActor) {
    const windowStart = Math.max(0, narrativeLogs.length - 10); // buildTurnMessage sends last 10
    for (let i = narrativeLogs.length - 2; i >= 0; i--) {
      const l: any = narrativeLogs[i];
      if (l.entry_type === "action" && l.characters?.name === resolvedActor.name) {
        if (i < windowStart) {
          const pair = [fmtLog(l)];
          const next: any = narrativeLogs[i + 1];
          if (next?.entry_type === "gm_response") pair.push(fmtLog(next));
          actorLastScene = pair.join("\n");
        }
        break;
      }
    }
  }

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
    npcs: structuredNpcs,
    objectives: resolveScenarioObjectives(scenario.objectives, scenario.winning_targets, scenario.each_player_targets),
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

  // Scene-tag this turn's scene-local facts with the actor's node (combat,
  // investigation, clue pickups all happened where the actor stands). Global
  // facts (unlocks, encounters) keep node undefined and never enter a scene
  // recap. Existing tags (set at the push site) are preserved.
  if (actorNode) {
    for (const e of [...newLedgerEntries, ...attackLedgerEntries]) {
      if (!e.node) e.node = actorNode;
    }
  }
  const updatedLedger = [...storyLedger, ...newLedgerEntries, ...attackLedgerEntries, ...locationLedgerEntries];

  // === OBJECTIVE STATUS (GM-only) ===
  // Tell the GM which objectives are already satisfied as of the start of this
  // turn, so it never re-narrates a completed goal as still pending (e.g. a key
  // already found). This is GM-internal — players never see a checklist (we hide
  // 任務目標 from the UI). Lives in the per-turn message since progress changes.
  const objList: Objective[] = Array.isArray(room.objectives) ? room.objectives : [];
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
  // Split-party scene context: the acting character's node (post-travel), the
  // NEXT actor's node (their choices bind to THAT scene), and everyone's
  // whereabouts so the GM never shows absent characters in the scene.
  const nextActorNode =
    locationGraph && locState && nextActor
      ? positionOf(locState, nextActor.id, locationGraph)
      : null;
  // Split party: the next actor's choices come from the isolated scene-locked
  // call, so the narrating GM is asked for none. Declared here (before the AI
  // input is built) because the response validator must know not to require 3.
  const nextIsElsewhere = !!(
    nextActor && resolvedActor && nextActor.id !== resolvedActor.id &&
    locationGraph && locState && nextActorNode && nextActorNode !== actorNode
  );
  const sceneCtx: SceneContext | null =
    locationGraph && locState && resolvedActor
      ? {
          actorName: resolvedActor.name,
          actorNode,
          nextName: nextActor?.name ?? resolvedActor.name,
          nextNode: nextActorNode ?? actorNode,
          whereabouts: sortedByDex.map((c: any) => ({
            name: c.name,
            node: positionOf(locState!, c.id, locationGraph!),
          })),
          // Scene memory: the last few ledger facts that happened AT this node,
          // so returning to a room keeps its physical state (the opened drawer
          // stays open even after other rooms' turns interleaved).
          sceneFacts: actorNode
            ? updatedLedger
                .filter((e) => e.node === actorNode)
                .slice(-5)
                .map((e) => `[T${e.turn}] ${e.character}: ${e.fact}`)
            : [],
          // The NEXT actor's scene history, so the GM's 3 choices can follow
          // that room's own story instead of repeating generic filler.
          nextSceneFacts: nextActorNode && nextActorNode !== actorNode
            ? updatedLedger
                .filter((e) => e.node === nextActorNode)
                .slice(-4)
                .map((e) => `[T${e.turn}] ${e.character}: ${e.fact}`)
            : [],
        }
      : null;
  const locationDirective =
    locationGraph && locState
      ? buildLocationBlock(
          locationGraph,
          locState,
          travelDirective,
          locState.stuck_counter >= 3
            ? locationGraph.nodes.find((n) => n.id === (actorNode ?? locState!.current))?.stuck_hint || null
            : null,
          room.current_round,
          locationFiredEncounters,
          objProgress,
          npcRoster,
          sceneCtx,
        )
      : null;

  // NPC status for the GM prompt — attach display names since state may be
  // keyed by stable id rather than name.
  const npcStatesForPrompt = Object.keys(npcStateNow).length
    ? Object.fromEntries(
        Object.entries(npcStateNow).map(([key, v]) => [
          key,
          {
            ...v,
            name: npcDisplayName(key, npcRoster),
            // Effective hostility (stance ?? legacy ?? disposition) so the GM
            // narrates a hostile NPC as hostile even on turns it doesn't swing.
            hostile: isNpcHostile(v, coerceDisposition((resolveNpc(key, scenarioNpcs) as any)?.disposition)),
          },
        ])
      )
    : null;

  // === NPC KNOWLEDGE (gated info reveals) ===
  // For each scenario NPC, include only knowledge entries whose 解鎖條件 gate is
  // currently satisfied (same grammar as location unlocks). Locked entries are
  // omitted entirely, so the GM literally cannot reveal them yet.
  const npcKnowledgeLines: string[] = [];
  for (const n of scenarioNpcs as Array<any>) {
    const entries: any[] = Array.isArray(n?.knowledge) ? n.knowledge : [];
    const available = entries.filter((k) => {
      const topic = typeof k?.topic === "string" ? k.topic.trim() : "";
      const info = typeof k?.info === "string" ? k.info.trim() : "";
      if (!topic || !info) return false;
      const when: string[][] = Array.isArray(k?.when) ? k.when : [];
      return evalUnlockConditions(when, locState, locationGraph, room.current_round, objProgress);
    });
    if (available.length === 0) continue;
    const lines = available
      .map((k) => `  · 當玩家向他/她問及「${k.topic.trim()}」→ 透露：${k.info.trim()}`)
      .join("\n");
    npcKnowledgeLines.push(`- ${n.name}：\n${lines}`);
  }
  const npcKnowledgeDirective = npcKnowledgeLines.length
    ? `NPC KNOWLEDGE (authoritative — the ONLY information each NPC may give, and ONLY when a player actually talks to THAT NPC and asks/brings up the matching topic in some form; match the player's meaning, not exact words). Reveal it naturally in the NPC's own voice when the topic genuinely comes up. Do NOT volunteer it unprompted, do NOT reveal an entry whose topic the player did not raise, and do NOT invent NPC knowledge beyond this list — anything not listed is either unknown to the NPC or not yet unlocked:\n${npcKnowledgeLines.join("\n")}`
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
    npcStates: npcStatesForPrompt,
    objectiveDirective,
    locationDirective,
    inventoryDirective: buildInventoryBlock(inventory),
    npcActionDirective: npcActionLines.length
      ? `NPC ACTIONS THIS TURN — MANDATORY NARRATION BEATS. The system already rolled these hostile-NPC attacks and ALREADY APPLIED THE HP LOSS; the players have seen the damage lines on screen. You MUST narrate every one of them as it happened. Omitting one produces a scene where a player silently loses HP for no reason they can read. Do NOT invent different outcomes, extra attacks, or attacks that were not listed:\n${npcActionLines.map((l) => `- ${l}`).join("\n")}`
      : null,
    npcKnowledgeDirective,
    actorLastScene,
    mythosDirective,
    itemsAwardedDirective: evidenceAwardedThisTurn.length
      ? `ITEMS AWARDED THIS TURN (the system already granted these to the party as a result of this action — the character now physically has them; you MUST work each pickup naturally into your narration, describing them noticing/finding/taking the item. Do NOT omit any, and do NOT invent items that are not listed):\n${evidenceAwardedThisTurn
          .map((e) => `- ${e.name}`)
          .join("\n")}`
      : null,
    currentRound: room.current_round,
    // Split party → the prompt asks for "choices": [], so the validator must
    // not reject the response for having 0 instead of 3.
    expectChoices: !nextIsElsewhere,
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

  // === SCENE-LOCKED CHOICES (split party) ===
  // When the next actor stands in a DIFFERENT location, their 3 choices are
  // generated by a SEPARATE micro-call whose entire context is THEIR scene —
  // the narrating GM never writes them. Isolation is the only airtight fix for
  // scene-bleed: the GM kept naming objects from its own narration (香爐, 供桌)
  // that exist in no structured data, so no text filter could catch them.
  // Launched here so it runs IN PARALLEL with the narration call (the actor's
  // turn cannot change the next actor's scene) — no added latency.
  // (nextIsElsewhere is declared above, alongside nextActorNode, because the
  // GM input needs it to set expectChoices.)
  let sceneChoicesPromise: Promise<string[]> | null = null;
  if (nextIsElsewhere && locationGraph && locState && nextActorNode && nextActor) {
    const nextNodeDef = locationGraph.nodes.find((n) => n.id === nextActorNode);
    const nextRegion = nextNodeDef?.container
      ? locationGraph.containers.find((c) => c.id === nextNodeDef.container)
      : null;
    const npcsHere = evaluateNpcPlacements(locationGraph, locState, room.current_round, objProgress, nextActorNode)
      .filter((ref) => npcStateEntry(ref, npcRoster, npcStateNow)?.alive !== false)
      .map((ref) => npcDisplayName(ref, npcRoster));
    const openExits = computeExits(locationGraph, locState, nextActorNode).open;
    const exitsOpen = openExits.map((n) => locationShortName(n.name));
    const exitsUnvisited = partitionExitsByNovelty(openExits, locState).fresh
      .map((n) => locationShortName(n.name));
    const nextFacts = updatedLedger
      .filter((e) => e.node === nextActorNode)
      .slice(-4)
      .map((e) => `[T${e.turn}] ${e.character}: ${e.fact}`);
    // The next actor's own last action, and the GM narration that answered it —
    // the strongest "what is going on in THEIR scene right now" signal. Ledger
    // facts alone ("取得證物X") are too terse to write story-aware choices from.
    const nameOf = (l: any) => (Array.isArray(l.characters) ? l.characters[0]?.name : l.characters?.name);
    let lastAction: string | null = null;
    let lastNarration: string | null = null;
    for (let i = narrativeLogs.length - 1; i >= 0; i--) {
      const l: any = narrativeLogs[i];
      if (l.entry_type === "action" && nameOf(l) === nextActor.name) {
        lastAction = l.content ?? null;
        const reply = narrativeLogs.slice(i + 1).find((x: any) => x.entry_type === "gm_response");
        lastNarration = (reply as any)?.content?.slice(0, 700) ?? null;
        break;
      }
    }
    sceneChoicesPromise = generateSceneChoices({
      characterName: nextActor.name,
      nodeName: locationShortName(nextNodeDef?.name ?? nextActorNode),
      regionName: nextRegion?.name ?? null,
      nodeDesc: nextNodeDef?.desc ?? null,
      npcsHere,
      exitsOpen,
      exitsUnvisited,
      sceneFacts: nextFacts,
      lastAction,
      lastNarration,
      skillTags: PLAYER_SKILL_LIST.map((s) => s.zh),
    }).catch((e) => {
      console.error("[scene-choices] generation failed:", e?.message ?? e);
      return [] as string[];
    });
  }

  // === STREAMING RESPONSE ===
  // Narration is streamed to the client token-by-token as the AI generates it
  // (the slow part of a turn); every OTHER piece of logic below — injury,
  // items, move_to, npc_calmed, objectives, endings — is UNCHANGED from the
  // non-streaming version, it just runs after the stream finishes instead of
  // after a single blocking await. NDJSON over a plain streamed fetch body
  // (one JSON object per line) rather than SSE, since the client already does
  // a normal POST with fetch() and doesn't need EventSource's GET-only reconnect
  // machinery.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: any) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }
  try {
    // === PRELUDE (variant B) — show the mechanics BEFORE the narration ===
    // Every mechanical row this turn (the action + its dice, 📍 travel, 📦
    // items, SAN media, unlock notices) is already persisted at this point.
    // Stream them now so the player sees the move + 檢定 first, then watches
    // the GM narration arrive as the payoff — instead of prose first and the
    // mechanics popping in at the end. The client renders these immediately
    // (deduped by id against the final fetchAll).
    if (turnStartedAt) {
      const { data: preludeRows } = await supabase
        .from("story_logs")
        .select("id, entry_type, content, character_id, player_id, created_at, roll_result, media_url, characters(name)")
        .eq("room_id", roomId)
        .gte("created_at", turnStartedAt)
        .order("created_at", { ascending: true });
      if (preludeRows && preludeRows.length) {
        send({ type: "prelude", rows: preludeRows });
      }
    }

    const gmResponse = await generateGMResponseStreaming(input, (deltaText) => {
      send({ type: "delta", text: deltaText });
    });

    // Enforce the suggested-action rules in CODE (strip character names, clamp
    // length, drop choices naming locked/hidden/unreachable places, backfill
    // zh-TW defaults). Choices are for the NEXT turn's position — if the GM
    // declared a move_to, validate against the anticipated destination so
    // legitimate choices at the new location aren't dropped.
    {
      // Choices belong to the NEXT actor — validate against THEIR node. The
      // actor's own move (deterministic or GM move_to) only shifts the choice
      // scene when the next actor IS the actor (single-player rooms).
      let choicesNode: string | null = nextActorNode ?? actorNode;
      const nextIsActor = !nextActor || !resolvedActor || nextActor.id === resolvedActor.id;
      if (nextIsActor && locationGraph && locState && typeof gmResponse.move_to === "string" && gmResponse.move_to.trim()) {
        const dest = resolveMoveTarget(gmResponse.move_to, locationGraph, locState, actorNode);
        if (dest) choicesNode = dest.id;
      }
      // SPLIT-PARTY CHOICES — scene isolation. When the next actor stands in a
      // DIFFERENT location, their 3 choices come from the parallel micro-call
      // that ONLY ever saw their scene (sceneChoicesPromise) — the narrating GM
      // never writes them, so it structurally CANNOT leak this scene into them.
      // The output is still validated/normalized against the next actor's node,
      // and composeSceneChoices remains the deterministic floor.
      if (nextIsElsewhere && locationGraph && locState && nextActorNode) {
        // It ran in parallel with the (much slower) narration call, so it is
        // almost certainly settled; the 5s race just means a hung provider can
        // never stall the turn — we fall back to composed choices instead.
        const isolated = sceneChoicesPromise
          ? await Promise.race([
              sceneChoicesPromise,
              // 5s was too tight to be a safety net: generateSceneChoices makes
              // up to TWO sequential attempts, and callAI may itself retry once
              // with reasoning off — so a call that was going to SUCCEED could
              // still lose the race and be thrown away for the generic
              // fallback. This only ever needs to outlast the narration stream
              // it runs beside, so give it real room; the guarantee we actually
              // want is "a hung provider cannot stall the turn forever".
              new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 20000)),
            ])
          : [];
        const sanitizedIso = sanitizeChoicesWithMeta(
          isolated,
          partyForAI.map((c) => c.name),
          locationGraph,
          locState,
          nextActorNode,
        );
        if (sanitizedIso.kept > 0) {
          gmResponse.choices = sanitizedIso.choices;
        } else {
          gmResponse.choices = composeSceneChoices(
            locationGraph, locState, nextActorNode, room.current_round, objProgress, npcRoster,
            (ref) => npcStateEntry(ref, npcRoster, npcStateNow)?.alive !== false,
          );
          // Say WHY: an empty `isolated` means the AI call itself failed (see
          // the [scene-choices] callAI error just above in the log); a non-empty
          // one means every suggestion was rejected by validation. Without this
          // distinction a frozen choice list looks identical in both cases.
          console.warn(
            `[scene-choices] composed fallback used for ${nextActor?.name ?? "next actor"} at ${nextActorNode}. ` +
            (isolated.length === 0
              ? "Cause: the isolated AI call returned nothing (check the [scene-choices] callAI error above)."
              : `Cause: all ${isolated.length} suggestion(s) failed validation: ${JSON.stringify(isolated)}`)
          );
        }
      } else {
        gmResponse.choices = sanitizeChoicesWithMeta(
          gmResponse.choices,
          partyForAI.map((c) => c.name),
          locationGraph,
          locState,
          choicesNode,
        ).choices;
      }
    }

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

    // === GM-DRIVEN MOVE (fallback) ===
    // The deterministic travel matcher handles clear phrasings before the GM
    // call; for everything else ("回去那裡", partials, typos) the GM — which
    // actually understands the sentence — declares move_to and the SERVER
    // validates it: only unlocked, non-current nodes are ever accepted, so the
    // GM can express intent but can never open a locked/hidden place.
    if (
      locationGraph && locState &&
      travelDirective?.kind !== "arrived" &&
      typeof gmResponse.move_to === "string" && gmResponse.move_to.trim()
    ) {
      const dest = resolveMoveTarget(gmResponse.move_to, locationGraph, locState, actorNode);
      if (dest) {
        // Moves ONLY the acting character (mirrors legacy current inside).
        const moved = resolvedActor
          ? applyActorMove(locationGraph, locState, resolvedActor.id, dest.id, room.current_round)
          : (() => {
              const fv = !locState!.visited.includes(dest.id);
              locState!.current = dest.id;
              if (fv) {
                locState!.visited.push(dest.id);
                locState!.entered_round[dest.id] = room.current_round;
                return { firstVisit: true, discovered: applyDiscovers(locationGraph!, locState!, dest.id) };
              }
              return { firstVisit: false, discovered: [] };
            })();
        actorNode = dest.id;
        const firstVisit = moved.firstVisit;
        if (firstVisit) {
          // Discovered-but-locked places surface silently on the map panel.
          const nodeImage = dest.node_image?.trim();
          const nodeText = dest.node_text?.trim();
          if (nodeImage || nodeText) {
            await supabase.from("story_logs").insert({
              room_id: roomId,
              round_number: room.current_round,
              entry_type: "location_media",
              content: nodeText && nodeText.length > 0
                ? nodeText
                : `📍 你抵達了「${locationShortName(dest.name)}」。`,
              media_url: nodeImage || null,
            });
          }
        }
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "system",
          content: `📍 ${resolvedActor?.name ?? "隊伍"} 前往：${locationShortName(dest.name)}`,
        });
        await supabase.from("rooms").update({ location_state: locState }).eq("id", roomId);
      }
    }

    // === GM-DRIVEN PACIFY ===
    // When the GM's narration genuinely reconciled with a hostile NPC, it names
    // that NPC in npc_calmed; the server clears its hostility (stance → neutral)
    // so it stops attacking from next round. Validated: only known, currently-
    // hostile NPCs are calmed — the GM cannot flip a peaceful NPC or invent one.
    const calmedRaw = gmResponse.npc_calmed;
    const calmedNames = Array.isArray(calmedRaw) ? calmedRaw : (typeof calmedRaw === "string" ? [calmedRaw] : []);
    if (calmedNames.length) {
      let calmStates = { ...npcStateNow };
      let calmChanged = false;
      for (const raw of calmedNames) {
        const name = typeof raw === "string" ? raw.trim() : "";
        if (!name) continue;
        const ref = npcRoster.find((n) => name.includes(n.name) || n.name.includes(name))?.name
          ?? Object.keys(calmStates).find((k) => name.includes(npcDisplayName(k, npcRoster)));
        if (!ref) continue;
        const key = npcStateKey(ref, npcRoster);
        const decl: any = resolveNpc(ref, scenarioNpcs);
        // Untracked disposition-hostile NPCs (no state entry yet) must be
        // calmable too — seed a state row from the declared sheet.
        const cur: any = calmStates[key] ?? npcStateEntry(ref, npcRoster, calmStates) ?? (() => {
          const maxHp = decl && typeof decl.hp === "number" ? decl.hp : 10;
          return { hp: maxHp, max_hp: maxHp, alive: true };
        })();
        if (cur && isNpcHostile(cur, coerceDisposition(decl?.disposition))) {
          calmStates[key] = { ...cur, stance: "neutral" };
          calmChanged = true;
          await supabase.from("story_logs").insert({
            room_id: roomId, round_number: room.current_round, entry_type: "system",
            content: `🕊 ${npcDisplayName(ref, npcRoster)} 與隊伍化解了敵意，不再攻擊。`,
          });
        }
      }
      if (calmChanged) {
        npcStateNow = calmStates;
        await supabase.from("rooms").update({ npc_states: npcStateNow }).eq("id", roomId);
      }
    }

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
        const npcStates = { ...npcStateNow };
        const stateKey = npcStateKey(injury.target, npcRoster);
        let npc = npcStateEntry(injury.target, npcRoster, npcStates);
        if (!npc) {
          const declaredNpc = resolveNpc(injury.target, structuredNpcs);
          const maxHp = declaredNpc ? declaredNpc.hp : Math.max(1, Math.min(30, Math.floor(injury.npc_max_hp ?? 10)));
          npc = { hp: maxHp, max_hp: maxHp, alive: true };
        }
        if (npc.alive) {
          npc = { ...npc, hp: Math.max(0, npc.hp - dmg.amount) };
          if (npc.hp <= 0) npc.alive = false;
          npcStates[stateKey] = npc;
          await supabase.from("rooms").update({ npc_states: npcStates }).eq("id", roomId);
          npcStateNow = npcStates; // keep in-memory state current for endings eval

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
          await admin.from("characters").update({ hp: newHp }).eq("id", targetChar.id);
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

    // Injuries and GM memory facts are scene-local too — tag with the actor's
    // node so returning to this room recalls them (scene memory).
    if (actorNode) {
      for (const e of [...injuryLedgerEntries, ...aiMemoryEntries]) {
        if (!e.node) e.node = actorNode;
      }
    }
    const finalLedger = [...updatedLedger, ...injuryLedgerEntries, ...aiMemoryEntries];

    // === INVENTORY UPDATE (party-wide soft layer) ===
    // 1) Bridge any 證物 awarded this turn into the bag (carries evidence_id).
    // 2) Apply the GM's narrated acquire/consume events. Context-only — this
    //    never gates progression, so a stray item is harmless.
    for (const ev of evidenceAwardedThisTurn) {
      inventory = addEvidenceItem(inventory, ev.name, ev.id, room.current_round);
    }
    const gmItems = gmResponse.items ?? null;
    const acquired = Array.isArray(gmItems?.acquired)
      ? gmItems!.acquired.filter((a) => a && typeof a.name === "string" && a.name.trim()).slice(0, 5)
      : [];
    const consumed = Array.isArray(gmItems?.consumed)
      ? gmItems!.consumed.filter((c): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 5)
      : [];
    const invResult = applyItemEvents(inventory, acquired, consumed, room.current_round);
    const inventoryChanged =
      evidenceAwardedThisTurn.length > 0 || invResult.added.length > 0 || invResult.removed.length > 0;
    inventory = invResult.next;
    if (inventoryChanged) {
      await supabase.from("rooms").update({ inventory }).eq("id", roomId);
      for (const it of invResult.added) {
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "system",
          content: `📦 取得物品：${it.name}`,
        });
      }
      for (const name of invResult.removed) {
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: room.current_round,
          entry_type: "system",
          content: `📦 用掉物品：${name}`,
        });
      }
    }

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
      send({
        type: "done",
        response: gmResponse.narration,
        gameEnded: true,
        ending: { type: "failure", title: tplTitle, summary: tplSummary },
      });
      controller.close();
      return;
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

    const scenarioEndings = coerceEndings(scenario?.endings);

    if (allDead) {
      ending = { triggered: true, type: "failure", title: tpdTitle, summary: tpdSummary };
    }

    // === OBJECTIVE TRACKER ===
    // Objectives are a TRACKER, not a game-ender. We track which ones the party
    // has completed (by their STABLE id), and the ending system below is what
    // actually decides when/how the story ends — via objective:<id> conditions.
    //
    // Creator-defined structured objectives are used directly (deterministic,
    // stable ids). Only a legacy scenario with no structured/free-text
    // objectives but free-text ending_conditions falls back to AI decomposition.
    let sharedObjectives: Objective[] = Array.isArray(room.objectives) ? room.objectives : [];
    let sharedProgress: ObjectiveProgress =
      room.objective_progress && typeof room.objective_progress === "object"
        ? { ...(room.objective_progress as ObjectiveProgress) }
        : {};

    const resolvedObjectiveDefs = resolveScenarioObjectives(
      scenario?.objectives,
      scenario?.winning_targets,
      scenario?.each_player_targets
    );

    if (!allDead && (resolvedObjectiveDefs.length > 0 || scenario?.ending_conditions)) {
      if (sharedObjectives.length === 0) {
        sharedObjectives =
          resolvedObjectiveDefs.length > 0
            ? resolvedObjectiveDefs
            : await decomposeObjectives(scenario.ending_conditions, scenario?.language ?? null);
        if (sharedObjectives.length > 0) {
          await supabase.from("rooms").update({ objectives: sharedObjectives }).eq("id", roomId);
        }
      }

      if (sharedObjectives.length > 0) {
        const livingPlayerNames = sortedByDex.filter((c: any) => c.hp > 0).map((c: any) => c.name);
        const incomplete = incompleteForActor(sharedObjectives, sharedProgress, actingName);
        const newlyDone = await checkObjectiveProgress(
          incomplete,
          storyLogSoFar,
          actionText,
          actingName,
          gmResponse.narration
        );

        if (newlyDone.length > 0) {
          sharedProgress = applyCompletions(
            sharedObjectives,
            sharedProgress,
            newlyDone,
            actingName,
            room.current_round,
            livingPlayerNames
          );
          await supabase.from("rooms").update({ objective_progress: sharedProgress }).eq("id", roomId);

          for (const id of newlyDone) {
            const obj = sharedObjectives.find((o) => o.id === id);
            if (!obj) continue;
            let content: string;
            if (obj.scope === "each_player" && sharedProgress[id]?.done !== true) {
              const done = Object.keys(sharedProgress[id]?.by ?? {}).length;
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
      }
    }

    // === ENDING SYSTEM — the SOLE authority over how the story ends ===
    // Every scenario is evaluated through the structured ending system. When a
    // creator defines no victory ending, we synthesise a default one from the
    // required objectives ("all key objectives done → victory") so the story can
    // still reach a satisfying close. Creator endings always win over it.
    if (!ending.triggered && !allDead) {
      const requiredObjIds = sharedObjectives.filter((o) => o.required).map((o) => o.id);
      const defaultVictory: ScenarioEnding | null =
        requiredObjIds.length > 0
          ? {
              id: "_default_victory",
              name: isZh ? "任務完成" : "Mission Complete",
              type: "victory",
              condition: [requiredObjIds.map((id) => `objective:${id}`)],
              description: isZh
                ? "隊伍達成了所有關鍵目標，冒險圓滿落幕。請依實際劇情描述每位角色的結局與這趟旅程的意義。"
                : "The party accomplished every key objective and the adventure reaches a satisfying close. Describe each character's fate based on what actually happened.",
              priority: -100,
            }
          : null;

      const effectiveEndings = defaultVictory
        ? [...scenarioEndings, defaultVictory].sort((a, b) => b.priority - a.priority)
        : scenarioEndings;

      if (effectiveEndings.length > 0) {
        const firedEnding = evaluateEndings(
          effectiveEndings,
          locState,
          locationGraph,
          npcStateNow as Record<string, { alive: boolean }>,
          sharedProgress as Record<string, { done?: boolean }>,
          room.current_round,
          npcRoster,
        );
        if (firedEnding) {
          const narration = await generateEndingNarration(
            firedEnding,
            scenario?.title ?? "the adventure",
            finalLedger,
            storyLogSoFar,
            scenario?.language ?? null,
          );
          ending = { triggered: true, type: firedEnding.type, title: narration.title, summary: narration.summary };
        }
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

      send({
        type: "done",
        response: gmResponse.narration,
        gameEnded: true,
        ending: {
          type: ending.type,
          title: ending.title,
          summary: ending.summary,
        },
      });
      controller.close();
      return;
    }

    // No ending triggered — update choices for next player as normal
    await supabase.from("rooms").update({
      current_choices: gmResponse.choices,
      current_choices_for_player_id: nextPlayerId,
    }).eq("id", roomId);

    send({
      type: "done",
      response: gmResponse.narration,
      choices: gmResponse.choices,
      choicesForPlayerId: nextPlayerId,
      gameEnded: false,
    });
    controller.close();
  } catch (err: any) {
    send({ type: "error", error: err.message });
    controller.close();
  }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
