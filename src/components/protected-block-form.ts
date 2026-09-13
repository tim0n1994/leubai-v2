import type { DomainStore } from "../domain/store.ts";
import type { CreateProtectedBlockCommand, DomainState, ProtectedBlock } from "../domain/types.ts";

function matchesBlock(value: ProtectedBlock | undefined, expected: ProtectedBlock): boolean {
  return !!value && value.id === expected.id && value.blockId === expected.blockId && value.revision === expected.revision && value.dataMode === expected.dataMode && value.status === "active" && value.intentId === expected.intentId && value.purpose === expected.purpose && value.range.start === expected.range.start && value.range.end === expected.range.end && value.range.timezone === expected.range.timezone && JSON.stringify(value.sourceRefs) === JSON.stringify(expected.sourceRefs);
}

export type ProtectedBlockSaveResult = { ok: true; block: ProtectedBlock } | { ok: false; reason: string; retryExact: boolean };

export async function saveProtectedBlock(store: DomainStore, readPersistedState: () => DomainState | null, command: CreateProtectedBlockCommand): Promise<ProtectedBlockSaveResult> {
  try {
    const result = await store.execute(command);
    if (!result.ok) return { ok: false, reason: `${result.code}：${result.reason}`, retryExact: result.code.startsWith("STORAGE_") };
    const block = result.data.protectedBlock;
    if (!matchesBlock(store.getState().protectedBlocks[block.id], block) || !matchesBlock(readPersistedState()?.protectedBlocks[block.id], block)) return { ok: false, reason: "保存结果尚未通过内存与本地存储双重读回。请重试同一记录，不会重复创建。", retryExact: true };
    return { ok: true, block };
  } catch {
    return { ok: false, reason: "本地保存结果尚未确认。内容仍保留，请重试同一记录。", retryExact: true };
  }
}
