import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import type {
  AttentionDeliveryOutcome,
  AttentionItem,
  CommandType,
  DomainState,
  EntityId,
  GrantKey,
  QueueEntry,
  RuleSet,
  RiskBasis,
} from "../types.ts";
import {
  bump,
  finish,
  lookupEntity,
  requireRevision,
  requireUser,
  tzOffsetMinutes,
  type RevisionChange,
} from "./shared.ts";
import { changeSetStaleReason } from "./plan.ts";
import { resolveAttentionDraftRef } from "../attentionDraftRef.ts";

function derivedBase(state: DomainState, ctx: Parameters<Handler>[2]) {
  return {
    revision: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    dataMode: state.dataMode,
  };
}

function dayInTz(iso: string, timezone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + tzOffsetMinutes(timezone, new Date(ms)) * 60000).toISOString().slice(0, 10);
}

function isCredibleRisk(urgency: AttentionItem["urgency"], basis: RiskBasis | null | undefined): boolean {
  return (
    urgency === "risk" &&
    !!basis &&
    basis.credibleSource &&
    basis.deadline.trim().length > 0 &&
    basis.consequence.trim().length > 0
  );
}

const EXPLICIT_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidDeferDueAt(dueAt: string | null): boolean {
  return dueAt === null || (EXPLICIT_ISO_TIMESTAMP.test(dueAt) && Number.isFinite(Date.parse(dueAt)));
}

function invalidateApprovalsByRuleRevision(state: DomainState, ruleRevision: number, now: string) {
  const approvals = { ...state.approvals };
  const invalidatedApprovalIds: EntityId[] = [];
  for (const ap of Object.values(state.approvals)) {
    if (ap.status !== "valid" || ap.ruleRevision === ruleRevision) continue;
    approvals[ap.id] = {
      ...bump(ap, now),
      status: "invalid" as const,
      invalidReason: "ruleset moved from revision " + ap.ruleRevision + " to " + ruleRevision,
    };
    invalidatedApprovalIds.push(ap.id);
  }
  return { approvals, invalidatedApprovalIds };
}

function revalidateApprovals(state: DomainState, now: string) {
  const approvals = { ...state.approvals };
  const invalidatedApprovalIds: EntityId[] = [];
  for (const ap of Object.values(state.approvals)) {
    if (ap.status !== "valid") continue;
    const cs = state.changeSets[ap.changeSetId];
    const stale = !cs
      ? "bound change set no longer exists"
      : (changeSetStaleReason(state, cs) ??
        (ap.changeSetHash !== cs.hash ? "change set hash no longer matches the approval binding" : null));
    if (stale) {
      approvals[ap.id] = { ...bump(ap, now), status: "invalid" as const, invalidReason: stale };
      invalidatedApprovalIds.push(ap.id);
    }
  }
  return { approvals, invalidatedApprovalIds };
}

export const governanceHandlers: Partial<Record<CommandType, Handler>> = {
  updateRules: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "updateRules" }>;
    const userFail = requireUser(c.actor, "updateRules");
    if (userFail) return userFail;
    if (!c.summary.trim()) return fail("INVALID_INPUT", "a summary describing the rule change is required", false);
    const changes: string[] = [];
    let grants = state.ruleset.grants;
    if (c.grants !== undefined) {
      grants = { ...grants };
      for (const [key, value] of Object.entries(c.grants)) {
        if (typeof value !== "boolean") {
          return fail("INVALID_INPUT", "grant " + key + " must be an explicit boolean", false);
        }
        grants[key as GrantKey] = value;
      }
      changes.push("grants");
    }
    let dailyCapacityMinutes = state.ruleset.dailyCapacityMinutes;
    if (c.dailyCapacityMinutes !== undefined) {
      if (!Number.isInteger(c.dailyCapacityMinutes) || c.dailyCapacityMinutes <= 0) {
        return fail("INVALID_INPUT", "dailyCapacityMinutes must be a positive whole number", false);
      }
      dailyCapacityMinutes = c.dailyCapacityMinutes;
      changes.push("dailyCapacityMinutes");
    }
    let timezone = state.ruleset.timezone;
    if (c.timezone !== undefined) {
      if (!c.timezone.trim()) return fail("INVALID_INPUT", "timezone must be a non-empty string", false);
      timezone = c.timezone;
      changes.push("timezone");
    }
    let budget = state.attention.budget;
    let budgetChange: RevisionChange | null = null;
    if (c.dailyReminderMax !== undefined) {
      if (c.entityId === null || c.expectedRevision === null) {
        return fail("INVALID_INPUT", "changing dailyReminderMax requires the current ruleset entityId and expectedRevision, not a null envelope", false);
      }
      if (c.entityId !== state.ruleset.id) {
        return fail("ENTITY_NOT_FOUND", "ruleset not found: " + c.entityId, false);
      }
      const envelopeFail = requireRevision(state.ruleset.revision, c.expectedRevision);
      if (envelopeFail) return envelopeFail;
      if (!Number.isInteger(c.dailyReminderMax) || c.dailyReminderMax < 0 || c.dailyReminderMax > 10) {
        return fail("INVALID_INPUT", "dailyReminderMax must be a whole number between 0 and 10, got " + String(c.dailyReminderMax), false);
      }
      changes.push("dailyReminderMax");
      budget = { ...bump(state.attention.budget, ctx.now), dailyMax: c.dailyReminderMax };
      budgetChange = { entityId: budget.id, before: state.attention.budget.revision, after: budget.revision };
    }
    const updated: RuleSet = {
      ...bump(state.ruleset, ctx.now),
      grants,
      dailyCapacityMinutes,
      timezone,
      history: [
        ...state.ruleset.history,
        { revision: state.ruleset.revision + 1, at: ctx.now, actor: c.actor, changes, description: c.summary },
      ],
    };
    const { approvals, invalidatedApprovalIds } = invalidateApprovalsByRuleRevision(state, updated.revision, ctx.now);
    const nextState = finish(
      state,
      { ruleset: updated, approvals, attention: { budget, items: state.attention.items } },
      [
        { entityId: updated.id, before: state.ruleset.revision, after: updated.revision },
        ...(budgetChange ? [budgetChange] : []),
        ...invalidatedApprovalIds.map((id) => ({
          entityId: id,
          before: state.approvals[id].revision,
          after: approvals[id].revision,
        })),
      ],
      {
        eventId: ctx.uuid(),
        type: "rules.updated",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary:
          "ruleset moved to revision " + updated.revision +
          (budgetChange ? "; dailyReminderMax set to " + budget.dailyMax : "") +
          "; " + invalidatedApprovalIds.length + " approval(s) invalidated: " + c.summary,
      },
    );
    return ok(nextState, { ruleset: updated, invalidatedApprovalIds });
  },

  submitRuleCandidate: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "submitRuleCandidate" }>;
    if (!c.proposedChanges.trim() || !c.rationale.trim()) {
      return fail("INVALID_INPUT", "a rule candidate needs both proposed changes and a rationale", false);
    }
    const item: AttentionItem = {
      id: ctx.uuid(),
      ...derivedBase(state, ctx),
      provenance: { origin: "model" as const },
      deliveryId: "rule-candidate-" + ctx.uuid(),
      mergeKey: "rule-candidate",
      title: c.proposedChanges,
      body: c.rationale,
      source: "ai",
      urgency: "normal",
      riskBasis: null,
      status: "pending",
      deliveredAt: null,
      budgetCharged: false,
    };
    const nextState = finish(
      state,
      { attention: { budget: state.attention.budget, items: { ...state.attention.items, [item.id]: item } } },
      [{ entityId: item.id, before: 0, after: 1 }],
      {
        eventId: ctx.uuid(),
        type: "rule.candidateSubmitted",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "model submitted a rule candidate as a pending attention item; rules themselves are unchanged",
      },
    );
    return ok(nextState, { attentionItem: item });
  },

  pauseAutomation: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "pauseAutomation" }>;
    const userFail = requireUser(c.actor, "pauseAutomation");
    if (userFail) return userFail;
    if (state.ruleset.paused) return ok(null, { ruleset: state.ruleset });
    const updated: RuleSet = { ...state.ruleset, paused: true, pauseEpoch: state.ruleset.pauseEpoch + 1, updatedAt: ctx.now };
    const nextState = finish(
      state,
      { ruleset: updated },
      [],
      {
        eventId: ctx.uuid(),
        type: "automation.paused",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "automation paused at epoch " + updated.pauseEpoch + "; data retained; bound approvals stay valid until state moves",
      },
    );
    return ok(nextState, { ruleset: updated });
  },

  resumeAutomation: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "resumeAutomation" }>;
    const userFail = requireUser(c.actor, "resumeAutomation");
    if (userFail) return userFail;
    if (!state.ruleset.paused) return ok(null, { ruleset: state.ruleset, invalidatedApprovalIds: [] });
    const { approvals, invalidatedApprovalIds } = revalidateApprovals(state, ctx.now);
    const updated: RuleSet = { ...state.ruleset, paused: false, updatedAt: ctx.now };
    const nextState = finish(
      state,
      { ruleset: updated, approvals },
      invalidatedApprovalIds.map((id) => ({
        entityId: id,
        before: state.approvals[id].revision,
        after: approvals[id].revision,
      })),
      {
        eventId: ctx.uuid(),
        type: "automation.resumed",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "automation resumed; " + invalidatedApprovalIds.length + " approval(s) failed revalidation against current state",
      },
    );
    return ok(nextState, { ruleset: updated, invalidatedApprovalIds });
  },

  deliverAttention: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "deliverAttention" }>;
    if (!c.deliveryId.trim()) return fail("INVALID_INPUT", "deliveryId is required for dedupe", false);
    if (!c.title.trim()) return fail("INVALID_INPUT", "title is required", false);
    if (c.draftRef !== undefined) {
      const linkedDraft = resolveAttentionDraftRef(state, c.draftRef);
      if (!linkedDraft.ok) return fail("INVALID_INPUT", linkedDraft.reason, false);
    }
    const existingItem = Object.values(state.attention.items).find((it) => it.deliveryId === c.deliveryId);
    if (existingItem) {
      const outcome: AttentionDeliveryOutcome = {
        delivered: false,
        duplicate: true,
        queued: false,
        merged: false,
        budgetCharged: false,
        budgetUsed: state.attention.budget.used,
        budgetMax: state.attention.budget.dailyMax,
        reason: "deliveryId was already delivered, queued, or merged earlier",
      };
      return ok(null, { outcome, item: existingItem });
    }
    let budget = state.attention.budget;
    const today = dayInTz(ctx.now, budget.timezone);
    if (today !== budget.budgetDay) {
      budget = { ...budget, budgetDay: today, used: 0, deliveredIds: [], updatedAt: ctx.now };
    }
    const mergeKey = c.mergeKey ?? "";
    const credibleRisk = isCredibleRisk(c.urgency, c.riskBasis);
    const withinBudget = budget.used < budget.dailyMax;
    const base: AttentionItem = {
      id: ctx.uuid(),
      ...derivedBase(state, ctx),
      provenance: { origin: "system" as const },
      deliveryId: c.deliveryId,
      mergeKey,
      title: c.title,
      body: c.body ?? "",
      source: c.source,
      urgency: c.urgency,
      riskBasis: c.riskBasis ?? null,
      status: "pending",
      deliveredAt: null,
      budgetCharged: false,
      ...(c.draftRef !== undefined ? { draftRef: { ...c.draftRef } } : {}),
    };
    const items = { ...state.attention.items };
    if (withinBudget || credibleRisk) {
      const deliveredBudget = {
        ...budget,
        used: budget.used + 1,
        deliveredIds: [...budget.deliveredIds, c.deliveryId],
        updatedAt: ctx.now,
      };
      const item: AttentionItem = {
        ...base,
        status: "delivered",
        deliveredAt: ctx.now,
        budgetCharged: true,
      };
      items[item.id] = item;
      const nextState = finish(
        state,
        { attention: { budget: deliveredBudget, items } },
        [{ entityId: item.id, before: 0, after: 1 }],
        {
          eventId: ctx.uuid(),
          type: "attention.delivered",
          commandId: c.commandId,
          actor: c.actor,
          at: ctx.now,
          summary: (credibleRisk && !withinBudget ? "credible risk bypassed the exhausted budget" : "delivered within budget") + "; used " + deliveredBudget.used + "/" + deliveredBudget.dailyMax,
        },
      );
      const outcome: AttentionDeliveryOutcome = {
        delivered: true,
        duplicate: false,
        queued: false,
        merged: false,
        budgetCharged: true,
        budgetUsed: deliveredBudget.used,
        budgetMax: deliveredBudget.dailyMax,
        reason: credibleRisk && !withinBudget ? "credible risk basis bypassed the exhausted budget" : "delivered within the shared budget",
      };
      return ok(nextState, { outcome, item });
    }
    const reason =
      c.urgency === "urgentClaim"
        ? "urgent claim without a credible risk basis does not bypass the budget"
        : c.urgency === "risk"
          ? "risk without a credible basis does not bypass the budget"
          : "daily attention budget exhausted";
    const existingQueue = mergeKey === "" ? undefined : budget.queue.find((q) => q.mergeKey === mergeKey);
    let item: AttentionItem = { ...base, status: "queued", budgetCharged: false };
    let queue: QueueEntry[];
    let merged = false;
    if (existingQueue) {
      merged = true;
      item = { ...item, status: "merged" };
      queue = budget.queue;
    } else {
      queue = [
        ...budget.queue,
        { id: ctx.uuid(), deliveryId: c.deliveryId, mergeKey, title: c.title, reason, queuedAt: ctx.now, dueAt: null },
      ];
    }
    items[item.id] = item;
    const queuedBudget = { ...budget, queue, updatedAt: ctx.now };
    const nextState = finish(
      state,
      { attention: { budget: queuedBudget, items } },
      [{ entityId: item.id, before: 0, after: 1 }],
      {
        eventId: ctx.uuid(),
        type: "attention.queued",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: (merged ? "merged into queue entry " + existingQueue?.mergeKey : "queued: " + reason),
      },
    );
    const outcome: AttentionDeliveryOutcome = {
      delivered: false,
      duplicate: false,
      queued: !merged,
      merged,
      budgetCharged: false,
      budgetUsed: queuedBudget.used,
      budgetMax: queuedBudget.dailyMax,
      reason: merged ? "merged into an existing queued entry with the same merge key" : reason,
    };
    return ok(nextState, { outcome, item });
  },

  deferAttention: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "deferAttention" }>;
    const userFail = requireUser(c.actor, "deferAttention");
    if (userFail) return userFail;
    const itemLookup = lookupEntity(state.attention.items, c.entityId, "attention item");
    if (itemLookup.failure) return itemLookup.failure;
    const item = itemLookup.entity;
    if (c.expectedRevision === null) {
      return fail("INVALID_INPUT", "deferAttention requires expectedRevision of the attention item", false);
    }
    const revisionFail = requireRevision(item.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (item.status === "dismissed") {
      return fail("INVALID_TRANSITION", "a dismissed attention item cannot be deferred", false);
    }
    if (!isValidDeferDueAt(c.dueAt)) {
      return fail("INVALID_INPUT", "deferAttention dueAt must be null or an explicit ISO timestamp", false);
    }
    const updated: AttentionItem = { ...bump(item, ctx.now), status: "deferred" };
    const existingEntry = state.attention.budget.queue.find((q) => q.deliveryId === updated.deliveryId);
    const queueEntry: QueueEntry = existingEntry
      ? { ...existingEntry, dueAt: c.dueAt }
      : {
          id: ctx.uuid(),
          deliveryId: updated.deliveryId,
          mergeKey: updated.mergeKey,
          title: updated.title,
          reason: "deferred by the user to a later time",
          queuedAt: ctx.now,
          dueAt: c.dueAt,
        };
    const queue = existingEntry
      ? state.attention.budget.queue.map((q) => (q.deliveryId === updated.deliveryId ? queueEntry : q))
      : [...state.attention.budget.queue, queueEntry];
    const budget = bump({ ...state.attention.budget, queue }, ctx.now);
    const nextState = finish(
      state,
      { attention: { budget, items: { ...state.attention.items, [updated.id]: updated } } },
      [
        { entityId: updated.id, before: item.revision, after: updated.revision },
        { entityId: budget.id, before: state.attention.budget.revision, after: budget.revision },
      ],
      {
        eventId: ctx.uuid(),
        type: "attention.deferred",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "attention item deferred to " + (c.dueAt ?? "no fixed date"),
      },
    );
    return ok(nextState, { item: updated });
  },

  dismissAttention: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "dismissAttention" }>;
    const userFail = requireUser(c.actor, "dismissAttention");
    if (userFail) return userFail;
    const itemLookup = lookupEntity(state.attention.items, c.entityId, "attention item");
    if (itemLookup.failure) return itemLookup.failure;
    const item = itemLookup.entity;
    const revisionFail = requireRevision(item.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (item.status === "dismissed") return ok(null, { item });
    const updated: AttentionItem = { ...bump(item, ctx.now), status: "dismissed" };
    const queue = state.attention.budget.queue.filter((q) => q.deliveryId !== updated.deliveryId);
    const budget = { ...state.attention.budget, queue, updatedAt: ctx.now };
    const nextState = finish(
      state,
      { attention: { budget, items: { ...state.attention.items, [updated.id]: updated } } },
      [{ entityId: updated.id, before: item.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "attention.dismissed",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "attention item dismissed and its queue entry removed",
      },
    );
    return ok(nextState, { item: updated });
  },
};
