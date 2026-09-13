import type { CommandBase, DomainCommand, DomainState, Source, SourceProvider } from "../types.ts";
import type { HandlerCtx, HandlerFailure } from "../store.ts";
import { fail } from "../store.ts";
import { bump, finish, lookupEntity, requireRevision, requireUser } from "./shared.ts";

import { isSourceRevocationReceipt } from "../sourceRevocationModel.ts";
import type { RemoteRevocationOutcome, SourceRevocationReceipt } from "../sourceRevocationModel.ts";
export { isSourceRevocationReceipt } from "../sourceRevocationModel.ts";
export type { RemoteRevocationOutcome, SourceRevocationReceipt } from "../sourceRevocationModel.ts";
export type RevokedSource = Source & { revocation: SourceRevocationReceipt };
export interface RevokeSourceAccessCommand extends CommandBase { type: "revokeSourceAccess" }
export interface RevokeSourceAtProviderCommand extends CommandBase {
  type: "revokeSourceAtProvider";
  provider?: Pick<SourceProvider, "revokeAccess">;
}
export type SourceRevocationCommand = RevokeSourceAccessCommand | RevokeSourceAtProviderCommand;
export type SourceRevocationData = { source: RevokedSource; localReadBlocked: true; remoteOutcome: RemoteRevocationOutcome; copyRecallClaim: "none" };
export type SourceRevocationResult = HandlerFailure | { ok: true; nextState: DomainState | null; data: SourceRevocationData };

function sourceForCommand(state: DomainState, command: SourceRevocationCommand): Source | HandlerFailure {
  const userFailure = requireUser(command.actor, command.type);
  if (userFailure) return userFailure;
  if (!command.entityId || command.expectedRevision === null || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
    return fail("INVALID_INPUT", "Source revocation requires exact source ID and revision", false);
  }
  const lookup = lookupEntity(state.sources, command.entityId, "source");
  if (lookup.failure) return lookup.failure;
  const revisionFailure = requireRevision(lookup.entity.revision, command.expectedRevision);
  return revisionFailure ?? lookup.entity;
}

function dataFor(source: RevokedSource): SourceRevocationData {
  return { source, localReadBlocked: true, remoteOutcome: source.revocation.remoteOutcome, copyRecallClaim: "none" };
}

export function revokeSourceAccess(state: DomainState, command: RevokeSourceAccessCommand, ctx: HandlerCtx): SourceRevocationResult {
  const source = sourceForCommand(state, command);
  if ("ok" in source) return source;
  if (source.status === "revoked" && source.accessRevokedAt && "revocation" in source && isSourceRevocationReceipt(source.revocation)) {
    return { ok: true, nextState: null, data: dataFor({ ...source, revocation: source.revocation }) };
  }
  const detail = "本地已停止后续读取；供应商撤权尚未确认，已传出的副本不受此操作保证。";
  const updated: RevokedSource = {
    ...bump(source, ctx.now), status: "revoked", accessRevokedAt: source.accessRevokedAt ?? ctx.now,
    coverage: { known: false, intervals: [] },
    lastUsableSnapshot: source.lastUsableSnapshot ? { ...source.lastUsableSnapshot, stale: true } : null,
    lastError: detail,
    revocation: { requestedAt: source.accessRevokedAt ?? ctx.now, checkedAt: null, remoteOutcome: "pending", detail, copyRecallClaim: "none" },
  };
  const plans = { ...state.plans };
  const approvals = { ...state.approvals };
  const changes = [{ entityId: source.id, before: source.revision, after: updated.revision }];
  for (const plan of Object.values(plans)) {
    if (plan.status === "invalid" || !(source.id in plan.sourceVersionSet)) continue;
    plans[plan.id] = { ...bump(plan, ctx.now), status: "invalid", invalidReason: "source access revoked: " + source.id };
    changes.push({ entityId: plan.id, before: plan.revision, after: plan.revision + 1 });
  }
  for (const approval of Object.values(approvals)) {
    if (approval.status !== "valid" || !(source.id in approval.sourceVersionSet)) continue;
    approvals[approval.id] = { ...bump(approval, ctx.now), status: "invalid", invalidReason: "source access revoked: " + source.id };
    changes.push({ entityId: approval.id, before: approval.revision, after: approval.revision + 1 });
  }
  const nextState = finish(state, { sources: { ...state.sources, [source.id]: updated }, plans, approvals }, changes, {
    eventId: ctx.uuid(), type: "source.accessRevokedLocally", commandId: command.commandId, actor: command.actor,
    at: ctx.now, summary: "Local reads stopped for source " + source.id + "; provider revocation pending; no copy recall claim",
  });
  return { ok: true, nextState, data: dataFor(updated) };
}

function classifyProviderResult(result: unknown): { remoteOutcome: RemoteRevocationOutcome; detail: string } {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok === true && "value" in result && result.value && typeof result.value === "object" && "revoked" in result.value) {
      if (result.value.revoked === true) return { remoteOutcome: "confirmed", detail: "供应商已确认撤权；本地仍禁止读取，已传出副本未被召回。" };
      if (result.value.revoked === false) return { remoteOutcome: "failed", detail: "供应商未完成撤权；本地仍禁止读取，需到来源账户检查权限。" };
    }
    if (result.ok === false) {
      const unknown = "mayHaveSideEffects" in result && result.mayHaveSideEffects === true;
      return { remoteOutcome: unknown ? "unknown" : "failed", detail: unknown
        ? "供应商撤权结果未知；本地仍禁止读取，需检查来源账户。"
        : "供应商拒绝或未完成撤权；本地仍禁止读取，需检查来源账户。" };
    }
  }
  return { remoteOutcome: "unknown", detail: "供应商返回无法确认的撤权结果；本地仍禁止读取。" };
}

export async function revokeSourceAtProvider(state: DomainState, command: RevokeSourceAtProviderCommand, ctx: HandlerCtx): Promise<SourceRevocationResult> {
  const source = sourceForCommand(state, command);
  if ("ok" in source) return source;
  if (source.status !== "revoked" || source.accessRevokedAt === null) {
    return fail("INVALID_TRANSITION", "Persist local source revocation before contacting the provider", false);
  }
  const previous = "revocation" in source && isSourceRevocationReceipt(source.revocation) ? source.revocation : null;
  if (previous?.remoteOutcome === "confirmed") return { ok: true, nextState: null, data: dataFor({ ...source, revocation: previous }) };
  let outcome: { remoteOutcome: RemoteRevocationOutcome; detail: string };
  if (!command.provider || typeof command.provider.revokeAccess !== "function") {
    outcome = { remoteOutcome: "unavailable", detail: "未提供此来源的撤权连接器；本地仍禁止读取，请到来源账户检查权限。" };
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result: unknown = await Promise.race([
        command.provider.revokeAccess(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("provider revocation timeout")), 10000); }),
      ]);
      outcome = classifyProviderResult(result);
    } catch {
      outcome = { remoteOutcome: "unknown", detail: "供应商撤权响应中断或超时，结果未知；本地仍禁止读取。" };
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  const updated: RevokedSource = {
    ...bump(source, ctx.now), status: "revoked", accessRevokedAt: source.accessRevokedAt,
    coverage: { known: false, intervals: [] },
    lastUsableSnapshot: source.lastUsableSnapshot ? { ...source.lastUsableSnapshot, stale: true } : null,
    lastError: outcome.remoteOutcome === "confirmed" ? null : outcome.detail,
    revocation: { requestedAt: previous?.requestedAt ?? source.accessRevokedAt, checkedAt: ctx.now,
      ...outcome, copyRecallClaim: "none" },
  };
  const nextState = finish(state, { sources: { ...state.sources, [source.id]: updated } },
    [{ entityId: source.id, before: source.revision, after: updated.revision }], {
      eventId: ctx.uuid(), type: "source.providerRevocation." + outcome.remoteOutcome, commandId: command.commandId,
      actor: command.actor, at: ctx.now, summary: "Source " + source.id + ": " + outcome.detail,
    });
  return { ok: true, nextState, data: dataFor(updated) };
}
export const sourceRevocationHandlers = {
  revokeSourceAccess(state: DomainState, command: DomainCommand | SourceRevocationCommand, ctx: HandlerCtx) {
    return command.type === "revokeSourceAccess" ? revokeSourceAccess(state, command, ctx) : fail("INVALID_INPUT", "Wrong command", false);
  },
  revokeSourceAtProvider(state: DomainState, command: DomainCommand | SourceRevocationCommand, ctx: HandlerCtx) {
    return command.type === "revokeSourceAtProvider" ? revokeSourceAtProvider(state, command, ctx) : fail("INVALID_INPUT", "Wrong command", false);
  },
};
