export interface ProofState {
  token: string;
  formSnapshot: string;
}

export interface SaveCompletionInput {
  formChangedSinceSubmit: boolean;
  formApiKey: string;
}

export interface SaveCompletionOutcome {
  testResult: null;
  testError: null;
  proof: null;
  apiKey: string;
  saveMessage: string;
}

export const SAVE_MESSAGE_SAVED = "已保存并启用";
export const SAVE_MESSAGE_SAVED_WITH_PENDING_EDITS =
  "已保存并启用提交时的配置；当前表单有未保存的修改。";

export function applySaveSuccess(input: SaveCompletionInput): SaveCompletionOutcome {
  const formChanged = input.formChangedSinceSubmit;
  return {
    testResult: null,
    testError: null,
    proof: null,
    apiKey: formChanged ? input.formApiKey : "",
    saveMessage: formChanged
      ? SAVE_MESSAGE_SAVED_WITH_PENDING_EDITS
      : SAVE_MESSAGE_SAVED,
  };
}
