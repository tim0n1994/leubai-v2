import { APPEARANCE_STORAGE_KEY, createAppearanceStore } from "./theme.ts";
import type { AppearanceDocumentLike, AppearanceStore, AppearanceStorageLike } from "./theme.ts";
import { peekAuthDataOwner } from "../auth/auth-session.ts";

function throwingStorage(): AppearanceStorageLike {
  return {
    getItem: () => {
      throw new Error("localStorage unavailable");
    },
    setItem: () => {
      throw new Error("localStorage unavailable");
    },
  };
}

function resolveBrowserStorage(): AppearanceStorageLike {
  try {
    if (typeof window === "undefined") throw new Error("no window");
    return window.localStorage;
  } catch {
    return throwingStorage();
  }
}

function resolveDocumentElement(): AppearanceDocumentLike | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement;
}

/**
 * Per-owner appearance key. Guests (and unconfirmed sessions) keep the legacy
 * key so existing device preferences stay readable without a migration.
 */
export function appearanceStorageKey(): string {
  const owner = peekAuthDataOwner();
  return owner === null || owner === "guest"
    ? APPEARANCE_STORAGE_KEY
    : APPEARANCE_STORAGE_KEY + ":u:" + owner;
}

let store: AppearanceStore | null = null;
let disposeSync: (() => void) | null = null;

export function getAppearanceStore(): AppearanceStore {
  if (!store) {
    store = createAppearanceStore({
      storage: resolveBrowserStorage(),
      doc: resolveDocumentElement(),
      resolveKey: appearanceStorageKey,
    });
  }
  return store;
}

export function initializeAppearance(): () => void {
  const appearanceStore = getAppearanceStore();
  appearanceStore.refreshFromStorage();
  if (disposeSync) return disposeSync;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === appearanceStorageKey()) {
      appearanceStore.refreshFromStorage();
    }
  };
  window.addEventListener("storage", onStorage);
  disposeSync = () => {
    window.removeEventListener("storage", onStorage);
    disposeSync = null;
  };
  return disposeSync;
}
