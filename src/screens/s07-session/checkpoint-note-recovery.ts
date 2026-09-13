export function checkpointNoteRecovery(failure: { readonly code: string; readonly retryable: boolean }): "rebase" | "retry" | "edit" {
  return failure.code === "REVISION_CONFLICT" ? "rebase" : failure.retryable ? "retry" : "edit";
}
