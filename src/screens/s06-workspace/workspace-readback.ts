import type { DomainPersistence } from "../../data/persistence.ts";
import type { DomainState } from "../../domain/types.ts";

export async function readWorkspaceSavedState(persistence: DomainPersistence): Promise<DomainState> {
  if (persistence.refresh) {
    const result = await persistence.refresh();
    if (!result.ok) throw new Error(result.reason);
  }
  const state = persistence.readFreshState();
  if (!state) throw new Error("无法读取已保存的工作区数据，请恢复连接后重试。");
  return state;
}
