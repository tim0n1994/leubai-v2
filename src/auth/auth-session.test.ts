import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthDataOwner } from "./auth-session.ts";
import { createAuthClient } from "./auth-client.ts";
import { createAuthController } from "./auth-controller.ts";
import type { AuthState } from "./auth-controller.ts";

const status = { enabled: true, emailDelivery: "email" as const, registrationEnabled: true, passwordMinLength: 12 };
const user = { id: "account-a", email: "a@example.com", displayName: "A", role: "user" as const, createdAt: "2026-09-13", emailVerified: true, isActive: true, settings: {} };
const ready: AuthState = { status, user: null, loading: false, busy: false, error: null };

test("only confirmed session state selects guest or an account owner", () => {
  assert.equal(resolveAuthDataOwner(ready), "guest");
  assert.equal(resolveAuthDataOwner({ ...ready, user }), "account-a");
  assert.throws(() => resolveAuthDataOwner({ ...ready, loading: true }), /尚未确认/);
  assert.throws(() => resolveAuthDataOwner({ ...ready, status: null }), /尚未确认/);
  assert.throws(() => resolveAuthDataOwner({ ...ready, error: "offline" }), /尚未确认/);
});

test("confirmed login and logout trigger reload callback, profile edits and failures do not", async () => {
  let changed = 0;
  let failLogin = false;
  const controller = createAuthController(createAuthClient(async (input) => {
    const path = String(input);
    if (path.endsWith("status")) return Response.json(status);
    if (path.endsWith("login") && failLogin) return Response.json({ detail: { message: "邮箱或密码不正确。" } }, { status: 401 });
    if (path.endsWith("logout")) return Response.json({ status: "ok" });
    return Response.json({ user });
  }), () => { changed += 1; });
  await controller.login(user.email, "long password");
  assert.equal(changed, 1);
  await controller.updateProfile({ displayName: "Updated" });
  assert.equal(changed, 1);
  await controller.logout();
  assert.equal(changed, 2);
  failLogin = true;
  await assert.rejects(controller.login(user.email, "wrong"));
  assert.equal(changed, 2);
});
