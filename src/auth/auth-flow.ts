export type AuthMode = "login" | "register" | "reset";
export interface AuthFlow { mode: AuthMode; step: "email" | "verify"; email: string; devCode: string | null }
export const initialAuthFlow: AuthFlow = { mode: "login", step: "email", email: "", devCode: null };
export type AuthFlowAction =
  | { type: "mode"; mode: AuthMode; registrationEnabled: boolean }
  | { type: "sent"; email: string; devCode?: string; showDevCode: boolean }
  | { type: "edit-email" }
  | { type: "reset-complete" };

export function authFlowReducer(state: AuthFlow, action: AuthFlowAction): AuthFlow {
  switch (action.type) {
    case "mode":
      return { ...initialAuthFlow, email: state.email, mode: action.mode === "register" && !action.registrationEnabled ? "login" : action.mode };
    case "sent":
      if (state.mode === "login") return state;
      return { ...state, step: "verify", email: action.email.trim(), devCode: action.showDevCode ? action.devCode ?? null : null };
    case "edit-email": return { ...state, step: "email", devCode: null };
    case "reset-complete": return { ...initialAuthFlow, email: state.email };
  }
}
