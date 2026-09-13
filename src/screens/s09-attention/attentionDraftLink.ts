import type { AttentionDraftResolution } from "../../domain/attentionDraftRef.ts";
import { workspaceSectionAnchor } from "../s06-workspace/section-anchor.ts";

export function attentionWorkspaceHref(target: AttentionDraftResolution): string | null {
  if (!target.ok) return null;
  const query = new URLSearchParams({ draftId: target.draftId, operationId: target.operationId });
  const anchor = target.sectionId === null ? "" : "#" + encodeURIComponent(workspaceSectionAnchor(target.sectionId));
  return "/workspace?" + query.toString() + anchor;
}
