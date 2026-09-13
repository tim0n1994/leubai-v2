import type { CaptureChannel, DomainState, EntityId } from "../../domain/types.ts";
import { viewFromDraftRecord, viewFromIntent } from "./s14-capture-adapter.ts";
import type { CaptureTarget, DraftState } from "./s14-capture-adapter.ts";

export type SavedCapture = { intentId: EntityId | null; draftId: EntityId | null; baseline: DraftState };
export type RestoredCapture =
  | { kind: "none" }
  | { kind: "skip" }
  | { kind: "restored"; channel: CaptureChannel; draft: DraftState; target: CaptureTarget | null; saved: SavedCapture | null };

export function restoreLatestCapture(state: DomainState): RestoredCapture {
  const intent = Object.values(state.intents)
    .filter(record => ["shortcut", "voice", "share"].includes(record.channel) && (record.status === "saved" || record.status === "ambiguous"))
    .reduce<(typeof state.intents)[string] | null>((latest, record) => latest === null || record.updatedAt >= latest.updatedAt ? record : latest, null);
  const draft = Object.values(state.captureDrafts)
    .filter(record => ["shortcut", "voice", "share"].includes(record.channel) && record.status !== "discarded")
    .reduce<(typeof state.captureDrafts)[string] | null>((latest, record) => latest === null || record.updatedAt >= latest.updatedAt ? record : latest, null);
  if (intent !== null && (draft === null || intent.updatedAt >= draft.updatedAt)) {
    return { kind: "restored", channel: intent.channel, draft: viewFromIntent(intent).draft, target: null, saved: null };
  }
  if (draft === null) return { kind: "none" };
  const view = viewFromDraftRecord(draft);
  if (view.kind === "intentSnapshot") return { kind: "skip" };
  return { kind: "restored", channel: draft.channel, draft: view.draft, target: view.target, saved: view.kind === "completed" ? { intentId: view.intentId, draftId: view.target.id, baseline: view.draft } : null };
}
