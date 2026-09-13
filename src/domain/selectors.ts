import type { DomainState, EntityId } from "./types.ts";

export interface CapacitySummary {
  date: string;
  capacityMinutes: number;
  committedKnownMinutes: number;
  unknownEffortCount: number;
  gapMinutes: number | null; // null when any scheduled commitment has unknown effort
  incomplete: boolean;
}

export function selectCapacitySummary(state: DomainState, date: string): CapacitySummary {
  const capacityMinutes = state.ruleset.dailyCapacityMinutes;
  let committedKnownMinutes = 0;
  let unknownEffortCount = 0;
  for (const c of Object.values(state.commitments)) {
    if (c.status !== "active") continue;
    if (!c.schedule || c.schedule.date !== date) continue;
    if (c.effortEstimateMinutes === null) unknownEffortCount += 1;
    else committedKnownMinutes += c.effortEstimateMinutes;
  }
  const incomplete = unknownEffortCount > 0;
  return {
    date,
    capacityMinutes,
    committedKnownMinutes,
    unknownEffortCount,
    gapMinutes: incomplete ? null : committedKnownMinutes - capacityMinutes,
    incomplete,
  };
}

export function isProtectedSuppressed(state: DomainState, blockId: string): boolean {
  for (const session of Object.values(state.quietSessions)) {
    if (session.blockId === blockId && session.suppressPrompts) return true;
  }
  return false;
}

export function selectOperationByKey(state: DomainState, idempotencyKey: string): EntityId | null {
  for (const op of Object.values(state.operations)) {
    if (op.idempotencyKey === idempotencyKey) return op.id;
  }
  return null;
}
