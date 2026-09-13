import type { DomainState } from "../../domain/types.ts";
import { isoDateOf, minuteOfDay } from "../s01-now/timeSurfaces.ts";
import type { MobileNowSurfaceModel } from "./mobile-now-context.ts";

export function buildMobileNowActions(state: DomainState, model: MobileNowSurfaceModel): { ledgerHref: string | null; setupHref: string | null } {
  if (!model.ready) return { ledgerHref: null, setupHref: model.reason === "noApplicableIntent" ? "/capture" : null };
  const date = model.capacity.date;
  const block = Object.values(state.protectedBlocks)
    .filter(entry => entry.status === "active" && entry.intentId === model.intentId && isoDateOf(entry.range.start) <= date && date <= isoDateOf(entry.range.end))
    .sort((a, b) => minuteOfDay(a.range.start) - minuteOfDay(b.range.start))[0];
  if (!block) return { ledgerHref: null, setupHref: "/capture" };
  const query = new URLSearchParams({ intentId: model.intentId, date, blockId: block.blockId });
  return { ledgerHref: "/ledger?" + query.toString(), setupHref: null };
}
