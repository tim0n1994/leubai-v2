import type { DomainState } from "./types.ts";

export type AttentionDraftResolution =
  | { ok: true; draftId: string; operationId: string; sectionId: string | null; sectionTitle: string | null }
  | { ok: false; reason: string };

export function resolveAttentionDraftRef(state: DomainState, raw: unknown): AttentionDraftResolution {
  const unavailable = (reason: string): AttentionDraftResolution => ({ ok: false, reason });
  if (raw === undefined) return unavailable("该条目没有关联的材料或草稿引用。");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return unavailable("草稿引用格式无效，无法确认目标。");
  const ref = raw as Record<string, unknown>;
  const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
  if (!validId(ref.draftId) || (ref.sectionId !== undefined && !validId(ref.sectionId))) return unavailable("草稿或小节标识无效，无法确认目标。");
  const draft = state.drafts[ref.draftId];
  if (!draft || draft.id !== ref.draftId || draft.dataMode !== state.dataMode) return unavailable("关联草稿已不存在或不属于当前数据空间。");
  if (draft.status === "withdrawn" || draft.status === "generating") return unavailable("关联草稿已撤回或尚未生成完成。");
  const operation = state.operations[draft.operationId];
  const owned = operation && operation.id === draft.operationId && operation.dataMode === state.dataMode &&
    (operation.resultRefs.includes(draft.id) || (operation.resultRefs.length === 0 && operation.stepReceipts.some(receipt => receipt.actionKind === "createDraft" && receipt.status === "completed" && receipt.resultRef === draft.id)));
  if (!owned) return unavailable("无法确认关联草稿的执行操作归属。");
  const matches = ref.sectionId === undefined ? [] : draft.sections.filter(section => section.id === ref.sectionId);
  if (ref.sectionId !== undefined && matches.length !== 1) return unavailable("关联小节已不存在或标识不唯一，不会打开其他小节。");
  return { ok: true, draftId: draft.id, operationId: operation.id, sectionId: matches[0]?.id ?? null, sectionTitle: matches[0]?.title ?? null };
}
