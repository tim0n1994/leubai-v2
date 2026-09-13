import { createContext, useContext, useSyncExternalStore } from "react";
import type { AuthController } from "./auth-controller";

export const AuthContext = createContext<AuthController | null>(null);

export function useAuth() {
  const controller = useContext(AuthContext);
  if (!controller) throw new Error("useAuth must be used inside AuthProvider");
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { ...state, actions: controller };
}
