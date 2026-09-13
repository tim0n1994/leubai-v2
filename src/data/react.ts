import { useSyncExternalStore } from "react";
import type { DomainState, DomainStore } from "../domain/index.ts";

export function useDomainState(store: DomainStore): DomainState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
