import type { DomainStore } from "../../domain/store.ts";
import type { DomainCommand } from "../../domain/types.ts";

export interface WorkspaceAttempt {
  readonly key: string;
  readonly command: DomainCommand;
}
interface WorkspaceCommandSnapshot {
  readonly pending: WorkspaceAttempt | null;
  readonly busy: boolean;
}
export interface WorkspaceCommandOutcome {
  readonly ok: boolean;
  readonly code: string | null;
  readonly text: string;
  readonly command: DomainCommand;
}

function createWorkspaceCommands(store: DomainStore) {
  let snapshot: WorkspaceCommandSnapshot = { pending: null, busy: false };
  let completePending: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: WorkspaceCommandSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const run = async (key: string, requested: DomainCommand, onSuccess?: () => void): Promise<WorkspaceCommandOutcome> => {
    const pending = snapshot.pending;
    if (snapshot.busy || (pending && (pending.key !== key || pending.command.entityId !== requested.entityId))) {
      return { ok: false, code: "WORKSPACE_UNRESOLVED", text: "已有结果未确认的操作，请先重试原操作。", command: requested };
    }
    const command = pending?.command ?? structuredClone(requested);
    const completed = pending ? completePending : onSuccess;
    publish({ pending, busy: true });
    let outcome: WorkspaceCommandOutcome;
    let uncertain = pending !== null;
    try {
      const result = await store.execute(command);
      if (result.ok) {
        outcome = { ok: true, code: null, text: "", command };
      } else {
        uncertain ||= result.code === "STORAGE_READBACK_UNVERIFIED" || result.details?.stage === "unknown" || result.details?.stage === "postwrite";
        outcome = { ok: false, code: result.code, text: result.code + "：" + result.reason, command };
      }
    } catch (error) {
      uncertain = true;
      outcome = { ok: false, code: "RUNTIME_THROWN", text: "执行结果未确认：" + (error instanceof Error ? error.message : String(error)), command };
    }
    if (outcome.ok) {
      completePending = undefined;
      publish({ pending: null, busy: false });
      completed?.();
    } else {
      completePending = uncertain ? completed : undefined;
      publish({ pending: uncertain ? { key, command } : null, busy: false });
    }
    return outcome;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run,
    retry: () => {
      const pending = snapshot.pending;
      return pending ? run(pending.key, pending.command) : Promise.resolve(null);
    },
  };
}

const controllers = new WeakMap<DomainStore, ReturnType<typeof createWorkspaceCommands>>();
export function workspaceCommands(store: DomainStore): ReturnType<typeof createWorkspaceCommands> {
  const existing = controllers.get(store);
  if (existing) return existing;
  const controller = createWorkspaceCommands(store);
  controllers.set(store, controller);
  return controller;
}
