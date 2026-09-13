import type { PersistedDomainHandle } from "../data/persistedStore.ts";
import { dueAttentionItems } from "../domain/attentionDue.ts";
import { defaultUuid } from "../domain/ids.ts";
import type { CommandFailure, ResurfaceAttentionCommand } from "../domain/types.ts";

type ReadyHandle = Extract<PersistedDomainHandle, { status: "ready" }>;

export interface AttentionDueSnapshot {
  pending: ResurfaceAttentionCommand | null;
  error: CommandFailure | null;
}

export interface AttentionDueController {
  tick(): Promise<void>;
  getSnapshot(): AttentionDueSnapshot;
}

const controllers = new WeakMap<ReadyHandle, AttentionDueController>();

export function attentionDueController(
  handle: ReadyHandle,
  options: { now?: () => string; uuid?: () => string } = {},
): AttentionDueController {
  const existing = controllers.get(handle);
  if (existing) return existing;
  const now = options.now ?? (() => new Date().toISOString());
  const uuid = options.uuid ?? defaultUuid;
  let snapshot: AttentionDueSnapshot = { pending: null, error: null };
  let running: Promise<void> | null = null;
  let checkRequested = false;

  const checkDue = async (): Promise<void> => {
    if (handle.store.getState().ruleset.paused) return;
    if (!snapshot.pending && handle.store.hasPendingWrites()) return;

    while (true) {
      let command = snapshot.pending;
      if (!command) {
        if (handle.store.hasPendingWrites()) return;
        const issuedAt = now();
        const item = dueAttentionItems(handle.store.getState(), issuedAt)[0];
        if (!item) return;
        command = Object.freeze({
          type: "resurfaceAttention",
          commandId: uuid(),
          actor: "automation",
          issuedAt,
          entityId: item.id,
          expectedRevision: item.revision,
        });
      }
      snapshot = { pending: command, error: null };
      const result = await handle.store.execute(command);
      if (!result.ok) {
        snapshot = { pending: command, error: result };
        return;
      }
      snapshot = { pending: null, error: null };
      if (!result.data.resurfaced || handle.store.getState().ruleset.paused) return;
    }
  };

  const controller: AttentionDueController = {
    getSnapshot: () => ({ ...snapshot }),
    tick() {
      checkRequested = true;
      if (!running) {
        running = (async () => {
          do {
            checkRequested = false;
            await checkDue();
          } while (checkRequested);
        })().finally(() => { running = null; });
      }
      return running;
    },
  };
  controllers.set(handle, controller);
  return controller;
}

type AttentionDueHost = Pick<typeof globalThis,
  "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener">;

const runtimes = new WeakMap<ReadyHandle, WeakMap<AttentionDueHost, () => void>>();

export function startAttentionDueRuntime(
  handle: ReadyHandle,
  host: AttentionDueHost = globalThis,
): () => void {
  let hosts = runtimes.get(handle);
  if (!hosts) {
    hosts = new WeakMap();
    runtimes.set(handle, hosts);
  }
  const existing = hosts.get(host);
  if (existing) return existing;
  const controller = attentionDueController(handle);
  const tick = () => { void controller.tick(); };
  const timer = host.setInterval(tick, 1000);
  host.addEventListener("focus", tick);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    host.clearInterval(timer);
    host.removeEventListener("focus", tick);
    hosts.delete(host);
  };
  hosts.set(host, stop);
  tick();
  return stop;
}
