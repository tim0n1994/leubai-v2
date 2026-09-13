import type { ReactNode } from "react";
import { getBrowserAuthController } from "./auth-session";
import { AuthContext } from "./use-auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const controller = getBrowserAuthController();
  return <AuthContext.Provider value={controller}>{children}</AuthContext.Provider>;
}
