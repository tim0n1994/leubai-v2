import { createInitialState, DOMAIN_SCHEMA_VERSION } from "../domain/state.ts";
import { isCheckpointNote } from "../domain/checkpointNoteModel.ts";
import { isCheckpointRulesSnapshot } from "../domain/checkpointRulesModel.ts";
import { createEmptyContextReviewState, validateContextReviewState } from "../domain/contextReviewModel.ts";
import { isSourceRevocationReceipt } from "../domain/sourceRevocationModel.ts";
import type { DataMode, DomainState } from "../domain/types.ts";
import type { LockManagerLike } from "./storage.ts";
import type { StorageLike } from "./storage.ts";

export const STORAGE_KEY_PREFIX = "leubai-v2:domain:v1:";

export interface DomainEnvelope {
  schemaVersion: number;
  dataMode: DataMode;
  savedAt: string;
  state: DomainState;
}

export type CommitFailureCode =
  | "REVISION_CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_READ_FAILED"
  | "STORAGE_READBACK_UNVERIFIED"
  | "STORAGE_CORRUPT"
  | "MIGRATION_FAILED";

export type CommitOutcome =
  | { ok: true }
  | {
      ok: false;
      code: CommitFailureCode;
      reason: string;
      retryable: boolean;
      storedGlobalRevision?: number;
      /** Set when a write landed but readback could not verify it; the durable outcome is unknown. */
      uncertain?: boolean;
    };

export type ParsedEnvelope =
  | { kind: "empty" }
  | { kind: "ok"; envelope: DomainEnvelope }
  | { kind: "corrupt" | "migrationFailed" | "namespaceMismatch"; reason: string; raw: string };

export function storageKeyFor(dataMode: DataMode, owner?: string): string {
  // Anonymous data stays in its original namespace; signing in never migrates it.
  return STORAGE_KEY_PREFIX + (owner && owner !== "guest" ? "u:" + owner + ":" : "") + dataMode;
}

const ENTITY_COLLECTIONS = [
  "sources",
  "intents",
  "captureDrafts",
  "protectedBlocks",
  "requests",
  "commitments",
  "plans",
  "changeSets",
  "approvals",
  "operations",
  "drafts",
  "checkpoints",
  "materials",
  "quietSessions",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entityCollectionError(collection: Record<string, unknown>, path: string): string | null {
  for (const [id, entity] of Object.entries(collection)) {
    if (!isRecord(entity)) return path + "." + id + " is not an entity object";
    if (typeof entity.id !== "string") return path + "." + id + " is missing a string id";
    if (typeof entity.revision !== "number") return path + "." + id + " is missing a numeric revision";
    if (path === "stored state.checkpoints" && entity.rulesSnapshot !== undefined && !isCheckpointRulesSnapshot(entity.rulesSnapshot)) return path + "." + id + " has invalid checkpoint rules snapshot";
    if (path === "stored state.checkpoints" && entity.notes !== undefined && (!Array.isArray(entity.notes) || !entity.notes.every(isCheckpointNote))) return path + "." + id + " has invalid checkpoint notes";
    if (path === "stored state.sources" && entity.revocation !== undefined && !isSourceRevocationReceipt(entity.revocation)) return path + "." + id + " has an invalid revocation receipt";
    if (path === "stored state.intents") {
      for (const key of ["pausedAt", "deletedAt"]) {
        const at = entity[key];
        if (at !== undefined && at !== null && (typeof at !== "string" || !Number.isFinite(Date.parse(at)))) return path + "." + id + " has an invalid " + key;
      }
      if (entity.status === "paused" && typeof entity.pausedAt !== "string") return path + "." + id + " is paused without a timestamp";
      if (entity.status === "deleted") {
        const fields = entity.parsedFields;
        if (typeof entity.deletedAt !== "string" || entity.verbatim !== "" || entity.ambiguityNote !== null || !isRecord(fields)
          || Object.keys(fields).length !== 5 || ["date", "startTime", "endTime", "timezone", "topic"].some(key => fields[key] !== null)
          || !isRecord(entity.fieldStatus) || Object.keys(entity.fieldStatus).length !== 0
          || !Array.isArray(entity.constraints) || entity.constraints.length !== 0
          || !Array.isArray(entity.sourceRefs) || entity.sourceRefs.length !== 0) return path + "." + id + " has a malformed deletion tombstone";
      }
    }
  }
  return null;
}

function stateShapeError(state: unknown): string | null {
  if (!isRecord(state)) return "stored state is not an object";
  if (typeof state.globalRevision !== "number") return "stored state.globalRevision is not a number";
  if (state.contextReview !== undefined) {
    const result = validateContextReviewState(state.contextReview);
    if (!result.ok) return "stored state.contextReview: " + result.reason;
  }
  for (const key of ENTITY_COLLECTIONS) {
    const collection = state[key];
    if (!isRecord(collection)) return "stored state." + key + " is not a record";
    const error = entityCollectionError(collection, "stored state." + key);
    if (error) return error;
  }
  const attention = state.attention;
  if (!isRecord(attention) || !isRecord(attention.items)) return "stored state.attention.items is not a record";
  return entityCollectionError(attention.items, "stored state.attention.items");
}

export function parseEnvelope(raw: string | null, dataMode: DataMode): ParsedEnvelope {
  if (raw === null) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt", reason: "stored payload is not valid JSON", raw };
  }
  const env = parsed as Partial<DomainEnvelope> | null;
  if (!env || typeof env !== "object" || typeof env.schemaVersion !== "number" || !env.state) {
    return { kind: "corrupt", reason: "stored payload is missing envelope fields", raw };
  }
  if (env.schemaVersion > DOMAIN_SCHEMA_VERSION) {
    return {
      kind: "migrationFailed",
      reason: "stored schemaVersion " + env.schemaVersion + " is newer than supported " + DOMAIN_SCHEMA_VERSION,
      raw,
    };
  }
  const shapeError = stateShapeError(env.state);
  if (shapeError) return { kind: "corrupt", reason: shapeError, raw };
  if (env.dataMode !== dataMode || env.state.dataMode !== dataMode) {
    return { kind: "namespaceMismatch", reason: "stored payload belongs to another dataMode namespace", raw };
  }
  const envelope = env as DomainEnvelope;
  return { kind: "ok", envelope: { ...envelope, state: { ...envelope.state,
    contextReview: envelope.state.contextReview ?? createEmptyContextReviewState(),
  } } };
}

export function readPersistedState(storage: StorageLike, dataMode: DataMode, owner?: string): ParsedEnvelope {
  return parseEnvelope(storage.getItem(storageKeyFor(dataMode, owner)), dataMode);
}

export interface DomainPersistence {
  readonly dataMode: DataMode;
  readonly openStatus: "ready" | "corrupt" | "migrationFailed" | "namespaceMismatch" | "readFailed" | "seedFailed";
  readonly openReason: string | null;
  readonly rawPayload: string | null;
  getState(): DomainState | null;
  readFreshState(): DomainState | null;
  /** Remote workspaces refresh asynchronously; local persistence reads synchronously. */
  refresh?(): Promise<CommitOutcome>;
  commit(expectedGlobalRevision: number, next: DomainState): Promise<CommitOutcome>;
  subscribeExternal(listener: () => void): () => void;
  resetFixtureOnly(): Promise<CommitOutcome>;
}

export interface OpenWorkspacePersistenceOptions {
  owner: string;
  fetch?: typeof fetch;
  currentOwner?: () => string | null;
}

function createEmptyWorkspaceState(): DomainState {
  const defaults = createInitialState("live");
  const at = new Date().toISOString();
  const state = { ...defaults, ledger: [], events: [], attention: {
    items: {},
    budget: { ...defaults.attention.budget, id: "live-attention-budget", createdAt: at, updatedAt: at, used: 0, deliveredIds: [], budgetDay: at.slice(0, 10), provenance: { origin: "system" as const } },
  }, ruleset: { ...defaults.ruleset, id: "live-ruleset", createdAt: at, updatedAt: at, history: [], provenance: { origin: "system" as const } } };
  for (const collection of ENTITY_COLLECTIONS) state[collection] = {};
  return state;
}

/** Account workspaces use the server's revision for CAS, independently of domain revisions. */
export async function openWorkspacePersistence(options: OpenWorkspacePersistenceOptions): Promise<{ persistence: DomainPersistence }> {
  const fetchImpl = options.fetch ?? fetch;
  let current: DomainState | null = null;
  let revision = 0;
  let openStatus: DomainPersistence["openStatus"] = "ready";
  let openReason: string | null = null;
  let pending: DomainState | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const ownerMatches = () => Boolean(options.owner && options.owner !== "guest") &&
    (!options.currentOwner || options.currentOwner() === options.owner);
  const notify = () => { for (const listener of listeners) listener(); };
  const unavailable = (reason: string): CommitOutcome => ({ ok: false, code: "STORAGE_UNAVAILABLE", reason, retryable: false });
  type Workspace = { revision: number; state: DomainState | null };
  type ResponseResult = { ok: true; workspace: Workspace } | { ok: false; outcome: CommitOutcome };

  async function request(method: "GET" | "PUT", next?: DomainState): Promise<ResponseResult> {
    if (!ownerMatches()) return { ok: false, outcome: unavailable("账号已变更，请重新打开工作区。") };
    let response: Response;
    try {
      response = await fetchImpl("/api/workspace", {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", "x-leubai-client": "leubai-settings/1", "x-leubai-workspace-owner": options.owner },
        ...(method === "PUT" ? { body: JSON.stringify({ expectedRevision: revision, state: next }) } : {}),
      });
    } catch (error) {
      return { ok: false, outcome: { ok: false, code: method === "PUT" ? "STORAGE_WRITE_FAILED" : "STORAGE_READ_FAILED", reason: errorText(error), retryable: true, ...(method === "PUT" ? { uncertain: true } : {}) } };
    }
    if (!ownerMatches()) return { ok: false, outcome: unavailable("账号已变更，请重新打开工作区。") };
    if (response.status === 401 || response.status === 403) return { ok: false, outcome: unavailable("登录已失效或账号不匹配，请重新登录后读取工作区。") };
    if (response.status === 409) return { ok: false, outcome: { ok: false, code: "REVISION_CONFLICT", reason: "工作区已在其他页面或设备更新，请检查最新内容后重试。", retryable: true } };
    if (!response.ok) return { ok: false, outcome: { ok: false, code: method === "PUT" ? "STORAGE_WRITE_FAILED" : "STORAGE_READ_FAILED", reason: "工作区服务返回 HTTP " + response.status, retryable: response.status >= 500, ...(method === "PUT" && response.status >= 500 ? { uncertain: true } : {}) } };
    try {
      const body: unknown = await response.json();
      if (!isRecord(body) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 ||
        (body.ownerId !== undefined && body.ownerId !== options.owner)) throw new Error("工作区返回无效的账号或版本。");
      if (body.state === null && body.revision === 0) return { ok: true, workspace: { revision: 0, state: null } };
      const parsed = parseEnvelope(JSON.stringify({ schemaVersion: isRecord(body.state) ? body.state.schemaVersion : null, dataMode: "live", state: body.state }), "live");
      if (parsed.kind !== "ok" || body.revision === 0) throw new Error(parsed.kind === "ok" || parsed.kind === "empty" ? "工作区版本无效。" : parsed.reason);
      return { ok: true, workspace: { revision: body.revision as number, state: parsed.envelope.state } };
    } catch (error) {
      return { ok: false, outcome: { ok: false, code: method === "PUT" ? "STORAGE_READBACK_UNVERIFIED" : "STORAGE_CORRUPT", reason: errorText(error), retryable: method === "PUT", ...(method === "PUT" ? { uncertain: true } : {}) } };
    }
  }

  function adopt(workspace: Workspace) {
    revision = workspace.revision;
    current = workspace.state ?? current ?? createEmptyWorkspaceState();
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }
  const initial = await request("GET");
  if (initial.ok) adopt(initial.workspace);
  else {
    openStatus = "readFailed";
    openReason = initial.outcome.ok ? "工作区无法读取。" : initial.outcome.reason;
  }
  const persistence: DomainPersistence = {
    dataMode: "live", openStatus, openReason, rawPayload: null,
    getState: () => current,
    readFreshState: () => ownerMatches() ? current : null,
    refresh: () => enqueue(async () => {
      const fresh = await request("GET");
      if (!fresh.ok) return fresh.outcome;
      // An unresolved write is acknowledged only by retrying its original candidate.
      if (pending && JSON.stringify(fresh.workspace.state) === JSON.stringify(pending)) return { ok: true };
      adopt(fresh.workspace);
      notify();
      return { ok: true };
    }),
    commit: (expectedGlobalRevision, next) => enqueue(async () => {
      if (openStatus !== "ready") return unavailable(openReason ?? "工作区未打开。");
      if (next.dataMode !== "live") return unavailable("演示数据不能写入账号工作区。");
      const fresh = await request("GET");
      if (!fresh.ok) return fresh.outcome;
      if (pending === next && JSON.stringify(fresh.workspace.state) === JSON.stringify(next)) {
        adopt(fresh.workspace);
        pending = null;
        return { ok: true };
      }
      const storedGlobalRevision = fresh.workspace.state?.globalRevision ?? current?.globalRevision ?? 1;
      if (fresh.workspace.revision !== revision || storedGlobalRevision !== expectedGlobalRevision) {
        adopt(fresh.workspace);
        pending = null;
        notify();
        return { ok: false, code: "REVISION_CONFLICT", reason: "工作区已更新，请检查最新内容后重新提交。", retryable: true, storedGlobalRevision };
      }
      pending = next;
      const saved = await request("PUT", next);
      if (!saved.ok) {
        if (!saved.outcome.ok && saved.outcome.code === "REVISION_CONFLICT") {
          pending = null;
          const latest = await request("GET");
          if (latest.ok) { adopt(latest.workspace); notify(); }
        } else if (!saved.outcome.ok && !saved.outcome.uncertain) pending = null;
        return saved.outcome;
      }
      if (saved.workspace.revision !== revision + 1 || JSON.stringify(saved.workspace.state) !== JSON.stringify(next)) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "服务端返回内容未确认本次保存，请重试原操作。", retryable: true, uncertain: true };
      }
      adopt(saved.workspace);
      pending = null;
      return { ok: true };
    }),
    subscribeExternal: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resetFixtureOnly: async () => unavailable("真实工作区不能通过演示重置清除。"),
  };
  return { persistence };
}

export interface OpenDomainPersistenceOptions {
  dataMode: DataMode;
  owner?: string;
  storage: StorageLike;
  locks?: LockManagerLike | null;
  createInitial?: (dataMode: DataMode) => DomainState;
}

interface PendingCandidate {
  kind: "commit" | "reset";
  raw: string;
  state: DomainState;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function openDomainPersistence(
  options: OpenDomainPersistenceOptions,
): Promise<{ persistence: DomainPersistence }> {
  const { dataMode, owner, storage, locks } = options;
  const key = storageKeyFor(dataMode, owner);
  const seedState = options.createInitial ?? ((dm: DataMode) => createInitialState(dm));
  type WithLock = <R>(cb: () => Promise<R>) => Promise<R>;
  const withLock: WithLock = locks
    ? (cb) => locks.request("leubai-v2:domain-lock:v1:" + key.slice(STORAGE_KEY_PREFIX.length), cb)
    : (cb) => cb();

  let current: DomainState | null = null;
  let openStatus: DomainPersistence["openStatus"] = "ready";
  let openReason: string | null = null;
  let rawPayload: string | null = null;
  let pending: PendingCandidate | null = null;

  const envelope = (state: DomainState): DomainEnvelope => ({
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    dataMode,
    savedAt: new Date().toISOString(),
    state,
  });

  const externalListeners = new Set<() => void>();
  let stopStorageSubscription: (() => void) | null = null;
  const notifyExternal = (): void => {
    for (const listener of externalListeners) listener();
  };

  const failureCodeForStatus = (status: DomainPersistence["openStatus"]): CommitFailureCode =>
    status === "migrationFailed"
      ? "MIGRATION_FAILED"
      : status === "readFailed"
        ? "STORAGE_READ_FAILED"
        : status === "seedFailed"
          ? "STORAGE_WRITE_FAILED"
          : "STORAGE_CORRUPT";

  const readFreshRaw = (): { ok: true; raw: string | null } | { ok: false; reason: string } => {
    try {
      return { ok: true, raw: storage.getItem(key) };
    } catch (err) {
      return { ok: false, reason: "STORAGE_READ_FAILED: " + errorText(err) };
    }
  };

  const writeWithReadback = (candidateState: DomainState, kind: PendingCandidate["kind"]): CommitOutcome => {
    const candidateRaw = JSON.stringify(envelope(candidateState));
    pending = { kind, raw: candidateRaw, state: candidateState };
    try {
      storage.setItem(key, candidateRaw);
    } catch (err) {
      pending = null;
      return { ok: false, code: "STORAGE_WRITE_FAILED", reason: errorText(err), retryable: true };
    }
    let readback: string | null = null;
    let readError: string | null = null;
    try {
      readback = storage.getItem(key);
    } catch (err) {
      readError = errorText(err);
    }
    if (readError !== null || readback !== candidateRaw) {
      return {
        ok: false,
        code: "STORAGE_READBACK_UNVERIFIED",
        reason:
          readError !== null
            ? "write succeeded but readback failed (" + readError + "); durable outcome uncertain"
            : "write succeeded but readback returned different bytes; durable outcome uncertain",
        retryable: true,
        uncertain: true,
      };
    }
    pending = null;
    current = candidateState;
    notifyExternal();
    return { ok: true };
  };

  const shouldForwardExternalChange = (): boolean => {
    const fresh = readFreshRaw();
    if (!fresh.ok) return false;
    const pendingNow = pending;
    if (pendingNow && fresh.raw === pendingNow.raw) return false;
    const parsed = parseEnvelope(fresh.raw, dataMode);
    if (parsed.kind !== "ok") return false;
    if (current && parsed.envelope.state.globalRevision <= current.globalRevision) return false;
    current = parsed.envelope.state;
    return true;
  };

  await withLock(async () => {
    const fresh = readFreshRaw();
    if (!fresh.ok) {
      openStatus = "readFailed";
      openReason = fresh.reason;
      return;
    }
    const parsed = parseEnvelope(fresh.raw, dataMode);
    if (parsed.kind === "ok") {
      current = parsed.envelope.state;
      return;
    }
    if (parsed.kind === "empty") {
      const seeded = writeWithReadback(seedState(dataMode), "reset");
      if (!seeded.ok) {
        pending = null;
        openStatus = "seedFailed";
        openReason =
          seeded.code === "STORAGE_WRITE_FAILED"
            ? "STORAGE_WRITE_FAILED: seed write failed: " + seeded.reason
            : "STORAGE_READBACK_UNVERIFIED: seed write could not be read back; durable outcome uncertain: " + seeded.reason;
        const durable = readFreshRaw();
        rawPayload = durable.ok ? durable.raw : null;
      }
      return;
    }
    openStatus = parsed.kind;
    openReason = parsed.reason;
    rawPayload = parsed.raw;
  });

  let queue: Promise<unknown> = Promise.resolve();

  const persistence: DomainPersistence = {
    dataMode,
    openStatus,
    openReason,
    rawPayload,
    getState: () => current,
    readFreshState: () => {
      const fresh = readFreshRaw();
      if (!fresh.ok) return null;
      if (pending && fresh.raw === pending.raw) return null;
      const parsed = parseEnvelope(fresh.raw, dataMode);
      return parsed.kind === "ok" ? parsed.envelope.state : null;
    },
    commit(expectedGlobalRevision: number, next: DomainState): Promise<CommitOutcome> {
      const run = queue.then(
        () =>
          withLock(async (): Promise<CommitOutcome> => {
            if (openStatus !== "ready") {
              return {
                ok: false,
                code: failureCodeForStatus(openStatus),
                reason: openReason ?? "storage is not readable",
                retryable: false,
              };
            }
            const fresh = readFreshRaw();
            if (!fresh.ok) {
              return { ok: false, code: "STORAGE_READ_FAILED", reason: fresh.reason, retryable: true };
            }
            // Given an unverified prior write: when durable bytes equal its exact raw
            // payload and the same candidate state is retried, then acknowledge it
            // without a second write.
            const pendingNow = pending;
            if (
              pendingNow &&
              pendingNow.kind === "commit" &&
              fresh.raw === pendingNow.raw &&
              next === pendingNow.state
            ) {
              current = pendingNow.state;
              pending = null;
              return { ok: true };
            }
            const parsed = parseEnvelope(fresh.raw, dataMode);
            if (parsed.kind === "migrationFailed") {
              return { ok: false, code: "MIGRATION_FAILED", reason: parsed.reason, retryable: false };
            }
            if (parsed.kind !== "ok" && parsed.kind !== "empty") {
              return { ok: false, code: "STORAGE_CORRUPT", reason: parsed.reason, retryable: false };
            }
            const storedRevision = parsed.kind === "ok" ? parsed.envelope.state.globalRevision : 0;
            const acceptable =
              storedRevision === expectedGlobalRevision ||
              (parsed.kind === "empty" && expectedGlobalRevision === 1); // nothing ever persisted
            if (!acceptable) {
              return {
                ok: false,
                code: "REVISION_CONFLICT",
                reason: "stored globalRevision " + storedRevision + " != expected " + expectedGlobalRevision,
                retryable: true,
                storedGlobalRevision: storedRevision,
              };
            }
            return writeWithReadback(next, "commit");
          }),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    subscribeExternal(listener: () => void): () => void {
      externalListeners.add(listener);
      if (stopStorageSubscription === null && storage.onExternalChange) {
        stopStorageSubscription = storage.onExternalChange((k) => {
          if (k !== key) return;
          if (!shouldForwardExternalChange()) return;
          notifyExternal();
        });
      }
      return () => {
        externalListeners.delete(listener);
        if (externalListeners.size === 0) {
          stopStorageSubscription?.();
          stopStorageSubscription = null;
        }
      };
    },
    async resetFixtureOnly(): Promise<CommitOutcome> {
      return withLock(async (): Promise<CommitOutcome> => {
        if (dataMode !== "fixture") {
          return { ok: false, code: "STORAGE_WRITE_FAILED", reason: "reset is only available for the fixture namespace", retryable: false };
        }
        if (openStatus !== "ready") {
          return { ok: false, code: failureCodeForStatus(openStatus), reason: openReason ?? "storage is not readable", retryable: false };
        }
        const fresh = readFreshRaw();
        if (!fresh.ok) {
          return { ok: false, code: "STORAGE_READ_FAILED", reason: fresh.reason, retryable: true };
        }
        const pendingNow = pending;
        if (pendingNow && pendingNow.kind === "reset" && fresh.raw === pendingNow.raw) {
          current = pendingNow.state;
          pending = null;
          return { ok: true };
        }
        return writeWithReadback(seedState(dataMode), "reset");
      });
    },
  };

  return { persistence };
}
