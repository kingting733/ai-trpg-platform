// SCENE REACTION — violence has witnesses.
//
// WHY: on an attack turn the GM was told only the mechanical outcome (ATTACK
// RESULT: hit / miss / damage). Nothing said who else stood in the room, or
// that a victim who never fights back still reacts — and the format rule
// makes NPC reaction optional ("only when they genuinely add something"). So
// a player could hit a harmless NPC in front of another one and the narration
// had both of them watch politely while the story moved on.
//
// The server knows who was attacked, whether that NPC fights back
// (fightsBack in lib/game/npc-combat.ts), whether its counter-attack was rolled
// this turn, and who is placed in the scene. This turns those facts into a
// mandatory narration beat. Pure: no I/O.

export interface SceneReactionFacts {
  /** Who did the violence (the acting character). */
  actor: string;
  victim: string;
  victimIsNpc: boolean;
  /** The blow landed (damage > 0). A miss still gets a reaction. */
  victimHurt: boolean;
  /** Dead / at 0 HP after this turn. */
  victimDown: boolean;
  /** NPC victim: false for a friendly NPC, who never fights back. */
  victimFightsBack: boolean;
  /** NPC victim: the server rolled its counter-attack this turn (NPC ACTIONS). */
  victimStruckBack: boolean;
  /** Living, non-hostile NPCs the server knows are standing in the scene. */
  witnesses: string[];
}

/** Named witnesses beyond this are folded into "the others" — a mob scene
 *  must not turn the narration into a roll call. */
const MAX_NAMED_WITNESSES = 4;

export function buildSceneReactionDirective(f: SceneReactionFacts): string {
  const lines: string[] = [];

  if (f.victimDown) {
    lines.push(`${f.victim} is down. Whoever saw it reacts to a killing, not a scuffle.`);
  } else if (!f.victimIsNpc) {
    lines.push(
      `${f.victim} is a player character: show only the immediate physical reaction (the stagger, the gasp) — what ${f.victim} does next is their player's choice.`
    );
  } else if (!f.victimFightsBack) {
    lines.push(
      `${f.victim} does NOT fight back — not now, not later; that is who ${f.victim} is. Show ${f.victim} reacting as a person, in character: ${f.victimHurt ? "pain and shock" : "the shock of the blow that missed"}, then cowering, pleading, crying out for help, or trying to get away.`
    );
  } else if (f.victimStruckBack) {
    lines.push(
      `${f.victim} fights back — its counter-attack is listed under NPC ACTIONS THIS TURN; narrate it as ${f.victim}'s answer to being attacked.`
    );
  } else {
    lines.push(
      `${f.victim} now treats ${f.actor} as an enemy — show it (fury, a raised guard, a weapon drawn). No counter-attack was rolled this turn, so do not narrate one.`
    );
  }

  const named = f.witnesses.slice(0, MAX_NAMED_WITNESSES);
  if (named.length) {
    const more = f.witnesses.length > named.length ? " and the others here" : "";
    lines.push(
      `WITNESSES — ${named.join("、")}${more} saw it happen. EACH must visibly react in this narration, true to their own personality and goal: a shout, a flinch, backing away, stepping in to stop it, running for help, a hand going to a weapon.`
    );
  }
  lines.push(
    `Anyone else the story has in this scene reacts too. Nobody carries on as if nothing happened, and the scene does not drift back to earlier business this turn.`
  );
  lines.push(
    `Reactions are words, faces and movement: none of them attacks or wounds anyone unless that attack is listed under NPC ACTIONS THIS TURN.`
  );

  return `SCENE REACTION — MANDATORY (${f.actor} just ${f.victimHurt ? "hurt" : "attacked"} ${f.victim} in front of others; the aftermath is part of this turn, not a footnote):\n${lines
    .map((l) => `- ${l}`)
    .join("\n")}`;
}
