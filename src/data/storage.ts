export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  onExternalChange?(listener: (key: string) => void): () => void;
}

/** In-memory adapter for deterministic tests; NOT durable. */
export class InMemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  private listeners = new Set<(key: string) => void>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
    for (const l of this.listeners) l(key);
  }

  removeItem(key: string): void {
    this.map.delete(key);
    for (const l of this.listeners) l(key);
  }

  onExternalChange(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Real browser persistence. Returns null outside a browser context. */
export function getBrowserLocalStorage(): StorageLike | null {
  const g = globalThis as { localStorage?: Storage };
  const ls = g.localStorage;
  if (!ls) return null;
  const w = globalThis as {
    addEventListener?: (t: string, cb: (e: { key?: string | null }) => void) => void;
    removeEventListener?: (t: string, cb: (e: { key?: string | null }) => void) => void;
  };
  const onExternalChange = (listener: (key: string) => void): (() => void) => {
    if (!w.addEventListener) return () => {};
    const cb = (e: { key?: string | null }) => {
      if (typeof e.key === "string") listener(e.key);
    };
    w.addEventListener("storage", cb);
    return () => {
      w.removeEventListener?.("storage", cb);
    };
  };
  return {
    getItem: (k) => ls.getItem(k),
    setItem: (k, v) => ls.setItem(k, v),
    removeItem: (k) => ls.removeItem(k),
    onExternalChange,
  };
}

export interface LockManagerLike {
  request<R>(name: string, cb: () => Promise<R>): Promise<R>;
}

/** Real browser Web Locks; null when the host provides no cross-tab mutex. */
export function getBrowserWebLocks(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
  if (!nav || !nav.locks) return null;
  return nav.locks as LockManagerLike;
}
