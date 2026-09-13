import { parseEnvelope, storageKeyFor } from "./persistence.ts";
import { getBrowserLocalStorage } from "./storage.ts";
import type { StorageLike } from "./storage.ts";
import type { DataMode } from "../domain/types.ts";

export interface BrowserWorkspaceBackup {
  dataMode: DataMode;
  storageKey: string;
  rawPayload: string;
  status: "ok" | "corrupt" | "migrationFailed" | "namespaceMismatch";
}

export interface BrowserWorkspaceRecovery {
  owner: string;
  backups: BrowserWorkspaceBackup[];
  readErrors: string[];
}

/** Read only the signed-in account's old namespaces; never seed, upload, or clear them. */
export function readBrowserWorkspaceRecovery(
  owner: string,
  storageProvider: () => StorageLike | null = getBrowserLocalStorage,
): BrowserWorkspaceRecovery | null {
  if (!owner || owner === "guest") return null;
  const recovery: BrowserWorkspaceRecovery = { owner, backups: [], readErrors: [] };
  let storage: StorageLike | null;
  try {
    storage = storageProvider();
  } catch {
    return { ...recovery, readErrors: ["浏览器存储无法访问，暂时无法检查旧工作区。"] };
  }
  if (!storage) return null;
  for (const dataMode of ["fixture", "live"] as const) {
    const storageKey = storageKeyFor(dataMode, owner);
    try {
      const rawPayload = storage.getItem(storageKey);
      const parsed = parseEnvelope(rawPayload, dataMode);
      if (parsed.kind !== "empty" && rawPayload !== null) {
        recovery.backups.push({ dataMode, storageKey, rawPayload, status: parsed.kind });
      }
    } catch {
      recovery.readErrors.push(`浏览器中的${dataMode === "fixture" ? "演示" : "真实"}工作区暂时无法读取。`);
    }
  }
  return recovery.backups.length || recovery.readErrors.length ? recovery : null;
}

export function serializeBrowserWorkspaceRecovery(recovery: BrowserWorkspaceRecovery): string {
  return JSON.stringify({ format: "leubai-browser-workspace-recovery-v1", ...recovery }, null, 2);
}
