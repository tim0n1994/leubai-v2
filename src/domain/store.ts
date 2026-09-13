import { createInitialState } from "./state.ts";
import { defaultUuid } from "./ids.ts";
import { commandHandlers } from "./commands.ts";
import type {
  CommandDataOf,
  CommandFailure,
  CommandResult,
  DataMode,
  DomainCommand,
  DomainState,
  FailureCode,
} from "./types.ts";

export type StoreCommitOutcome =
  | { ok: true }
  | { ok: false; code: FailureCode; reason: string; retryable: boolean };

export interface DomainStore {
  getState(): DomainState;
  hasPendingWrites(): boolean;
  subscribe(listener: (s: DomainState) => void): () => void;
  execute<C extends DomainCommand>(command: C): Promise<CommandResult<C>>;
  /** Adopt a state written by another tab (storage event); notifies subscribers. */
  adoptExternalState(next: DomainState): void;
}

export interface DomainStoreOptions {
  dataMode: DataMode;
  initialState?: DomainState;
  now?: () => string;
  uuid?: () => string;
  commit?: (expectedGlobalRevision: number, next: DomainState) => Promise<StoreCommitOutcome>;
}

export interface HandlerCtx {
  now: string;
  uuid: () => string;
}

export interface HandlerFailure {
  ok: false;
  code: FailureCode;
  reason: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface HandlerSuccess {
  ok: true;
  nextState: DomainState | null;
  data: Record<string, unknown>;
}

export type HandlerOutcome = HandlerFailure | HandlerSuccess;

export type Handler = (
  state: DomainState,
  command: DomainCommand,
  ctx: HandlerCtx,
) => HandlerOutcome | Promise<HandlerOutcome>;

export function fail(code: FailureCode, reason: string, retryable: boolean, details?: Record<string, unknown>): HandlerFailure {
  return { ok: false, code, reason, retryable, details };
}

export function ok(nextState: DomainState | null, data: Record<string, unknown>): HandlerSuccess {
  return { ok: true, nextState, data };
}

interface PendingWriteCandidate {
  command: DomainCommand;
  baseRevision: number;
  baseState: DomainState;
  nextState: DomainState;
  data: Record<string, unknown>;
}

interface CommittedCommandRecord {
  command: DomainCommand;
  data: Record<string, unknown>;
}

interface RejectedCommandRecord {
  command: DomainCommand;
  stage: "prewrite" | "postwrite";
}

function identityEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    if (!identityEqual(aRecord[key], bRecord[key])) return false;
  }
  return true;
}

// Deliberately not JSON.stringify: own keys holding undefined must survive so
// the snapshot stays identityEqual-compatible with the original command. The
// copy shares no reference with the caller-owned object and never mutates it.
function snapshotCommandValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotCommandValue);
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      copy[key] = snapshotCommandValue(source[key]);
    }
    return copy;
  }
  return value;
}

const ACTORS: ReadonlySet<string> = new Set(["user", "automation", "model"]);

export function createDomainStore(options: DomainStoreOptions): DomainStore {
  const now = options.now ?? (() => new Date().toISOString());
  const uuid = options.uuid ?? defaultUuid;
  let state: DomainState =
    options.initialState ?? createInitialState(options.dataMode, { now });
  const listeners = new Set<(s: DomainState) => void>();

  const notify = () => {
    for (const listener of listeners) listener(state);
  };

  const pendingWrites = new Map<string, PendingWriteCandidate>();
  const committedCommands = new Map<string, CommittedCommandRecord>();
  const rejectedCommands = new Map<string, RejectedCommandRecord>();

  const candidateCompatibleWithState = (candidate: PendingWriteCandidate): boolean =>
    identityEqual(state, candidate.baseState) || identityEqual(state, candidate.nextState);

  const conflictFailure = (commandId: string, reason: string): CommandFailure => ({
    ok: false,
    commandId,
    code: "CONFLICT",
    reason,
    retryable: false,
  });

  const settlePendingWrite = async <C extends DomainCommand>(
    candidate: PendingWriteCandidate,
  ): Promise<CommandResult<C>> => {
    const commandId = candidate.command.commandId;
    if (options.commit) {
      if (!candidateCompatibleWithState(candidate)) {
        pendingWrites.delete(commandId);
        rejectedCommands.set(commandId, { command: candidate.command, stage: "prewrite" });
        return {
          ok: false,
          commandId,
          code: "REVISION_CONFLICT",
          reason:
            "domain state advanced to revision " + state.globalRevision +
            " after this commandId's candidate was captured at revision " + candidate.baseRevision +
            "; the retained candidate is not compatible with the current state and was not re-sent to storage",
          retryable: true,
          details: {
            stage: "prewrite",
            candidateBaseRevision: candidate.baseRevision,
            currentRevision: state.globalRevision,
          },
        };
      }
      let commitResult: StoreCommitOutcome;
      try {
        commitResult = await options.commit(candidate.baseRevision, candidate.nextState);
      } catch (error) {
        return {
          ok: false,
          commandId,
          code: "STORAGE_WRITE_FAILED",
          reason:
            "commit callback threw: " + (error instanceof Error ? error.message : String(error)) +
            "; storage write stage unknown: the durable effect may or may not have landed; retry the exact same command to resolve safely",
          retryable: true,
          details: { stage: "unknown" },
        };
      }
      if (!commitResult.ok) {
        return {
          ok: false,
          commandId,
          code: commitResult.code,
          reason: commitResult.reason,
          retryable: commitResult.retryable,
        };
      }
      if (!candidateCompatibleWithState(candidate)) {
        pendingWrites.delete(commandId);
        rejectedCommands.set(commandId, { command: candidate.command, stage: "postwrite" });
        return {
          ok: false,
          commandId,
          code: "REVISION_CONFLICT",
          reason:
            "an externally adopted state with different content appeared while commit was in flight; the committed candidate is not published over it",
          retryable: true,
          details: {
            stage: "postwrite",
            candidateBaseRevision: candidate.baseRevision,
            currentRevision: state.globalRevision,
          },
        };
      }
    }
    pendingWrites.delete(commandId);
    committedCommands.set(commandId, { command: candidate.command, data: candidate.data });
    state = candidate.nextState;
    notify();
    return { ok: true, commandId, data: candidate.data as CommandDataOf<C> };
  };

  let executionChain: Promise<unknown> = Promise.resolve();
  const enqueueExecution = <T>(task: () => Promise<T>): Promise<T> => {
    const run = executionChain.then(task, task);
    executionChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    getState: () => state,
    hasPendingWrites: () => pendingWrites.size > 0,
    subscribe(listener: (s: DomainState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    adoptExternalState(next: DomainState) {
      if (next.dataMode !== state.dataMode) return;
      if (next.globalRevision <= state.globalRevision) return;
      state = next;
      notify();
    },
    async execute<C extends DomainCommand>(command: C): Promise<CommandResult<C>> {
      if (typeof command.commandId !== "string" || command.commandId.length === 0) {
        return { ok: false, commandId: "", code: "INVALID_INPUT", reason: "commandId is required", retryable: false };
      }
      if (typeof command.actor !== "string" || !ACTORS.has(command.actor)) {
        return {
          ok: false,
          commandId: command.commandId,
          code: "INVALID_INPUT",
          reason: "actor must be user | automation | model",
          retryable: false,
        };
      }
      const handler = commandHandlers[command.type];
      if (!handler) {
        return {
          ok: false,
          commandId: command.commandId,
          code: "INVALID_INPUT",
          reason: "unknown command type: " + String(command.type),
          retryable: false,
        };
      }
      const commandSnapshot = snapshotCommandValue(command) as C;
      return enqueueExecution(async () => {
        const committedRecord = committedCommands.get(commandSnapshot.commandId);
        if (committedRecord) {
          if (identityEqual(commandSnapshot, committedRecord.command)) {
            return { ok: true, commandId: commandSnapshot.commandId, data: committedRecord.data as CommandDataOf<C> };
          }
          return conflictFailure(
            commandSnapshot.commandId,
            "commandId was already committed with a different command payload; issue the new payload under a fresh commandId",
          );
        }
        const pendingCandidate = pendingWrites.get(commandSnapshot.commandId);
        if (pendingCandidate) {
          if (!identityEqual(commandSnapshot, pendingCandidate.command)) {
            return conflictFailure(
              commandSnapshot.commandId,
              "commandId has an unresolved write candidate captured from a different command payload; retries must resend the exact original command",
            );
          }
          return settlePendingWrite<C>(pendingCandidate);
        }
        const rejectedRecord = rejectedCommands.get(commandSnapshot.commandId);
        if (rejectedRecord) {
          if (!identityEqual(commandSnapshot, rejectedRecord.command)) {
            return conflictFailure(
              commandSnapshot.commandId,
              "commandId was already rejected as stale after an external state divergence; issue the new payload under a fresh commandId",
            );
          }
          return {
            ok: false,
            commandId: commandSnapshot.commandId,
            code: "REVISION_CONFLICT",
            reason:
              "this commandId's write candidate was rejected as stale after an external state divergence at the " + rejectedRecord.stage +
              " stage; the exact original payload stays fail-closed and never re-executes to avoid a duplicate effect; issue a genuinely new requested action under a fresh commandId",
            retryable: false,
            details: { stage: rejectedRecord.stage, rejected: true },
          };
        }
        const initialState = state;
        const initialRevision = state.globalRevision;
        const stateMoved = () => state !== initialState || state.globalRevision !== initialRevision;
        const outcome = await handler(initialState, commandSnapshot, { now: now(), uuid });
        if (!outcome.ok) {
          return {
            ok: false,
            commandId: commandSnapshot.commandId,
            code: outcome.code,
            reason: outcome.reason,
            retryable: outcome.retryable,
            details: outcome.details,
          };
        }
        if (!outcome.nextState) {
          return { ok: true, commandId: commandSnapshot.commandId, data: outcome.data as CommandDataOf<C> };
        }
        if (stateMoved()) {
          return {
            ok: false,
            commandId: commandSnapshot.commandId,
            code: "REVISION_CONFLICT",
            reason:
              "domain state moved to revision " + state.globalRevision +
              " while the command ran; candidate captured at revision " + initialRevision + " is discarded",
            retryable: true,
          };
        }
        const candidate: PendingWriteCandidate = {
          command: commandSnapshot,
          baseRevision: initialRevision,
          baseState: initialState,
          nextState: outcome.nextState,
          data: outcome.data,
        };
        pendingWrites.set(commandSnapshot.commandId, candidate);
        return settlePendingWrite<C>(candidate);
      });
    },
  };
}
