import type { DomainStore } from "../../domain/store.ts";
import type { Source } from "../../domain/types.ts";
import type { RevokeSourceAccessCommand, RevokeSourceAtProviderCommand, SourceRevocationCommand } from "../../domain/handlers/sourceRevocation.ts";

interface CommandIdentity { commandId: string; issuedAt: string }

export function makeLocalRevocation(source: Source, identity: CommandIdentity): RevokeSourceAccessCommand {
  return { ...identity, type: "revokeSourceAccess", entityId: source.id, expectedRevision: source.revision, actor: "user" };
}

export function makeProviderRevocation(source: Source, identity: CommandIdentity): RevokeSourceAtProviderCommand {
  return { ...identity, type: "revokeSourceAtProvider", entityId: source.id, expectedRevision: source.revision, actor: "user",
    provider: source.dataMode === "fixture" ? { revokeAccess: async () => ({ ok: true, value: { revoked: true } }) } : undefined };
}

export async function executeSourceRevocation(store: DomainStore, command: SourceRevocationCommand, identity: () => CommandIdentity): Promise<
  { ok: true; source: Source } | { ok: false; reason: string; pending: SourceRevocationCommand | null }
> {
  let active = command;
  try {
    const local = await store.execute(active);
    if (!local.ok) return { ok: false, reason: local.reason, pending: local.retryable ? active : null };
    if (active.type === "revokeSourceAtProvider") return { ok: true, source: local.data.source };
    active = makeProviderRevocation(local.data.source, identity());
    const remote = await store.execute(active);
    if (!remote.ok) return { ok: false, reason: remote.reason, pending: remote.retryable ? active : null };
    return { ok: true, source: remote.data.source };
  } catch {
    return { ok: false, reason: "写入结果暂时无法确认，请重试原撤权记录。", pending: active };
  }
}

export function describeSourceRevocation(source: Source) {
  const receipt = source.revocation;
  const outcome = receipt?.remoteOutcome ?? "pending";
  const labels = { pending: "待确认", confirmed: "已确认", failed: "未完成", unknown: "结果未知", unavailable: "连接器不可用" };
  return {
    status: (source.dataMode === "fixture" ? "合成演示回执：" : "供应商撤权：") + labels[outcome],
    detail: source.dataMode === "fixture"
      ? "仅作用于合成演示数据，不代表真实账户权限已改变；本地仍停止读取，已传出副本不会因此被召回。"
      : receipt?.detail ?? "本地已停止读取；供应商撤权尚未确认，已传出副本不会因此被召回。",
    requestedAt: receipt?.requestedAt ?? source.accessRevokedAt,
    checkedAt: receipt?.checkedAt ?? null,
  };
}
