import { AuthError, authErrorMessage, createAuthClient } from "./auth-client.ts";
import type { AuthClient, AuthStatus, AuthUser } from "./auth-client.ts";

export interface AuthState {
  user: AuthUser | null;
  status: AuthStatus | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
}

export function createAuthController(client: AuthClient = createAuthClient(), onIdentityChange?: () => void) {
  let state: AuthState = { user: null, status: null, loading: true, busy: false, error: null };
  let revision = 0;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<AuthState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  async function refresh() {
    if (state.busy) return;
    const current = ++revision;
    publish({ loading: true, error: null });
    try {
      const status = await client.status();
      let user: AuthUser | null = null;
      if (status.enabled) {
        try { user = (await client.me()).user; }
        catch (error) { if (!(error instanceof AuthError && error.status === 401)) throw error; }
      }
      if (current === revision) publish({ user, status, loading: false });
    } catch (error) {
      if (current === revision) publish({ loading: false, error: authErrorMessage(error) });
    }
  }
  async function perform<T>(action: () => Promise<T>, onSuccess?: (result: T) => Partial<AuthState>): Promise<T> {
    if (state.busy) throw new AuthError("正在处理上一项账号操作，请稍候。");
    ++revision;
    publish({ busy: true, loading: false, error: null });
    try {
      const result = await action();
      const patch = onSuccess?.(result);
      const previousId = state.user?.id;
      publish({ ...patch, busy: false });
      if (previousId !== state.user?.id) onIdentityChange?.();
      return result;
    } catch (error) {
      const previousId = state.user?.id;
      publish({ busy: false, error: authErrorMessage(error), ...(error instanceof AuthError && error.status === 401 ? { user: null } : {}) });
      if (previousId !== state.user?.id) onIdentityChange?.();
      throw error;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    login: (email: string, password: string) => perform(() => client.login(email, password), ({ user }) => ({ user })),
    sendCode: (email: string, purpose: "register" | "reset") => perform(() => {
      if (!state.status?.enabled || state.status.emailDelivery === "unavailable") throw new AuthError("邮箱验证服务尚未配置，请联系管理员。");
      if (purpose === "register" && !state.status.registrationEnabled) throw new AuthError("注册暂未开放。");
      return client.sendCode(email, purpose);
    }),
    register: (email: string, code: string, password: string, displayName: string) => perform(() => {
      if (!state.status?.registrationEnabled) throw new AuthError("注册暂未开放。");
      return client.register(email, code, password, displayName);
    }, ({ user }) => ({ user })),
    resetPassword: (email: string, code: string, password: string) => perform(() => client.resetPassword(email, code, password), () => ({ user: null })),
    logout: () => perform(() => client.logout(), () => ({ user: null })),
    updateProfile: (data: { displayName?: string; settings?: Record<string, unknown> }) => perform(() => client.updateProfile(data), ({ user }) => ({ user })),
    updatePassword: (oldPassword: string, newPassword: string) => perform(() => client.updatePassword(oldPassword, newPassword)),
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
