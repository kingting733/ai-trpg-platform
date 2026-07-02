// Server-authoritative NPC aggression — the mirror of the player attack path.
//
// When an NPC is hostile and present in the scene, the SERVER rolls its attack
// against a player using the same resolveAttack machinery players use (to-hit,
// the target's 閃避, damage + STR/SIZ bonus, crit, fumble). The AI GM only
// narrates the outcome the system computed. This keeps NPC combat fair,
// dodge-able, and consistent instead of left to the GM's whim.

import { CheckCharacter, AttackType } from "./resolution";

export type NpcDisposition = "hostile" | "neutral" | "friendly";

/** Combat-relevant runtime state, stored per NPC in rooms.npc_states. */
export interface NpcRuntimeState {
  hp: number;
  max_hp: number;
  alive: boolean;
  /** Runtime combat stance — OVERRIDES the scenario disposition. Set to
   *  "hostile" on retaliation, "neutral" when pacified. */
  stance?: NpcDisposition;
  /** Legacy one-way hostility flag (pre-stance rooms). Read for back-compat. */
  hostile?: boolean;
  /** Round of this NPC's most recent attack — throttles to one per round. */
  last_attack_round?: number;
}

/** Effective stance = runtime override, else the legacy hostile flag, else the
 *  scenario disposition. Lets pacify work even on disposition:"hostile" NPCs. */
export function effectiveStance(
  state: NpcRuntimeState | undefined | null,
  disposition: NpcDisposition,
): NpcDisposition {
  if (state?.stance) return state.stance;
  if (state?.hostile) return "hostile";
  return disposition;
}

export function isNpcHostile(
  state: NpcRuntimeState | undefined | null,
  disposition: NpcDisposition,
): boolean {
  return effectiveStance(state, disposition) === "hostile";
}

/** Stats needed to make an NPC attack; sourced from the scenario NpcEntry. */
export interface NpcCombatProfile {
  str?: number;
  siz?: number;
  dex?: number;
  skills?: Record<string, number> | null;
  armed?: boolean;
}

// Average-human fallback so a stat-less, GM-invented NPC can still fight.
const DEF_STR = 50;
const DEF_SIZ = 50;
const DEF_DEX = 50;

export function coerceDisposition(v: unknown): NpcDisposition {
  return v === "hostile" || v === "friendly" ? v : "neutral";
}

// A competent-combatant baseline so NPCs aren't stuck at the untrained-player
// 搏鬥/射擊 default of 25. Overridden by any skills the NPC actually carries.
const NPC_BASE_SKILLS = { fighting: 45, firearms: 35 };

/** Shape an NPC into the CheckCharacter that resolveAttack expects. Only the
 *  combat-relevant fields matter; the rest are filled with neutral averages. */
export function npcAsAttacker(profile: NpcCombatProfile): CheckCharacter {
  return {
    hp: 0, san: 0, mp: 0,
    str: profile.str ?? DEF_STR,
    con: 50,
    siz: profile.siz ?? DEF_SIZ,
    dex: profile.dex ?? DEF_DEX,
    app: 50, int: 50, pow: 50, edu: 50, luck: 50,
    skills: { ...NPC_BASE_SKILLS, ...(profile.skills ?? {}) },
  };
}

export function npcAttackType(profile: NpcCombatProfile): AttackType {
  return profile.armed ? "ranged" : "fighting";
}
