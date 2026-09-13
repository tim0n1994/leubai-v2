import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import type { CommandType, ResurfaceAttentionCommand } from "../types.ts";
import { attentionDueReason, currentAttentionBudget } from "../attentionDue.ts";
import { bump, finish, lookupEntity, requireRevision } from "./shared.ts";

export const attentionDueHandlers: Partial<Record<CommandType, Handler>> = {
  resurfaceAttention: (state, command, ctx) => {
    const c = command as ResurfaceAttentionCommand;
    if (c.actor === "model") return fail("USER_ONLY", "A model cannot trigger an attention delivery", false);
    const lookup = lookupEntity(state.attention.items, c.entityId, "attention item");
    if (lookup.failure) return lookup.failure;
    const item = lookup.entity;
    if (c.expectedRevision === null) return fail("INVALID_INPUT", "Resurfacing requires the deferred item's revision", false);
    const stale = requireRevision(item.revision, c.expectedRevision);
    if (stale) return stale;
    const blocked = attentionDueReason(state, item, ctx.now);
    if (blocked) return ok(null, { item, resurfaced: false, reason: blocked });
    const currentBudget = currentAttentionBudget(state.attention.budget, ctx.now);
    if (!currentBudget) return fail("INVALID_INPUT", "Budget date cannot be verified", false);
    const charge = !currentBudget.deliveredIds.includes(item.deliveryId);
    const budget = bump({ ...currentBudget, used: currentBudget.used + (charge ? 1 : 0), deliveredIds: charge ? [...currentBudget.deliveredIds, item.deliveryId] : currentBudget.deliveredIds, queue: currentBudget.queue.filter(row => row.deliveryId !== item.deliveryId) }, ctx.now);
    const updated = { ...bump(item, ctx.now), status: "delivered" as const, deliveredAt: ctx.now, budgetCharged: true };
    const next = finish(state, { attention: { budget, items: { ...state.attention.items, [item.id]: updated } } }, [
      { entityId: item.id, before: item.revision, after: updated.revision },
      { entityId: budget.id, before: state.attention.budget.revision, after: budget.revision },
    ], { eventId: ctx.uuid(), type: "attention.resurfaced", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "Deferred item returned to the local attention list under its original delivery ID; " + (charge ? "charged once in current budget day" : "already charged in current budget day") + "; no external notification" });
    return ok(next, { item: updated, resurfaced: true, reason: "deferred schedule reached its due time" });
  },
};
