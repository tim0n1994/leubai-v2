import { useEffect, useState } from "react";
import { createPersistedDomainStore } from "../data/index.ts";
import { getAuthDataOwner, getBrowserAuthController } from "../auth/auth-session.ts";
import type { DataMode } from "../domain/types.ts";

export type DomainRuntimeHandle = Awaited<ReturnType<typeof createPersistedDomainStore>>;
export type ReadyDomainRuntime = Extract<DomainRuntimeHandle, { status: "ready" }>;

export type DomainRuntimeState =
  | { status: "loading"; dataMode: DataMode }
  | { status: "ready"; dataMode: DataMode; runtime: ReadyDomainRuntime }
  | { status: "unavailable"; dataMode: DataMode; handle: DomainRuntimeHandle | null; reason: string };

const runtimeCache = new Map<string, Promise<DomainRuntimeHandle>>();

function runtimeKey(dataMode: DataMode): string {
  return dataMode + "::" + getAuthDataOwner();
}

export function getDefaultDataMode(): DataMode {
  return getAuthDataOwner() === "guest" ? "fixture" : "live";
}

export function getDomainRuntime(dataMode: DataMode = getDefaultDataMode()): Promise<DomainRuntimeHandle> {
  const key = runtimeKey(dataMode);
  const cached = runtimeCache.get(key);
  if (cached) return cached;
  const initializing = createPersistedDomainStore({
    dataMode,
    owner: getAuthDataOwner(),
    currentOwner: () => {
      const auth = getBrowserAuthController().getSnapshot();
      // A failed account mutation (for example a wrong password) can leave a
      // valid authenticated user in place. Keep that owner usable; only an
      // unresolved initial session or a confirmed anonymous error should block
      // remote writes.
      if (auth.loading) return null;
      if (auth.user?.id) return auth.user.id;
      return auth.error ? null : "guest";
    },
  }).then((handle) => {
    if (handle.status === "ready" && handle.persistence.refresh && typeof window !== "undefined") {
      window.addEventListener("focus", () => { void handle.persistence.refresh?.(); });
    }
    return handle;
  }).catch((err: unknown) => {
    if (runtimeCache.get(key) === initializing) runtimeCache.delete(key);
    throw err;
  });
  runtimeCache.set(key, initializing);
  return initializing;
}

export function retryDomainRuntime(dataMode: DataMode = getDefaultDataMode()): Promise<DomainRuntimeHandle> {
  const key = runtimeKey(dataMode);
  const cached = runtimeCache.get(key);
  if (!cached) return getDomainRuntime(dataMode);
  const settledReady = cached.then(
    (handle) => handle.status === "ready",
    () => false,
  );
  return settledReady.then((ready) => {
    if (ready) return cached;
    const staleInitStillCached = runtimeCache.get(key) === cached;
    if (staleInitStillCached) {
      runtimeCache.delete(key);
    }
    return getDomainRuntime(dataMode);
  });
}

export function useDomainRuntime(dataMode: DataMode = getDefaultDataMode()): DomainRuntimeState {
  const [state, setState] = useState<DomainRuntimeState>({ status: "loading", dataMode });
  if (state.dataMode !== dataMode) {
    setState({ status: "loading", dataMode });
  }
  useEffect(() => {
    let subscribed = true;
    getDomainRuntime(dataMode).then(
      (handle) => {
        if (!subscribed) return;
        if (handle.status === "ready") {
          setState({ status: "ready", dataMode, runtime: handle });
        } else {
          setState({ status: "unavailable", dataMode, handle, reason: handle.reason });
        }
      },
      (err: unknown) => {
        if (!subscribed) return;
        setState({
          status: "unavailable",
          dataMode,
          handle: null,
          reason: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => {
      subscribed = false;
    };
  }, [dataMode]);
  return state;
}
