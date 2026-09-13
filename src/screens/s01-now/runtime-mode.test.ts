import assert from "node:assert/strict";
import test from "node:test";
import { AuthError } from "../../auth/auth-client.ts";
import type { AuthState } from "../../auth/auth-controller.ts";

const accountUser = {
  id: "account-a",
  email: "a@example.com",
  displayName: "Account A",
  createdAt: "2026-09-13T00:00:00.000Z",
  role: "user" as const,
  emailVerified: true,
  isActive: true,
  settings: {},
};

type AuthSessionModule = typeof import("../../auth/auth-session.ts");
type RuntimeModule = typeof import("../../runtime/index.ts");

const authStub = { meStatus: 200 };

function stubAuthFetch(): void {
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const path = String(input);
    if (path.endsWith("/api/auth/status")) {
      return Response.json({ enabled: true, emailDelivery: "email", registrationEnabled: true, passwordMinLength: 12, codeResendSeconds: 60 });
    }
    if (path.endsWith("/api/auth/me")) {
      return authStub.meStatus === 200 ? Response.json({ user: accountUser }) : Response.json({ error: "unauthorized" }, { status: authStub.meStatus });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  };
}

// The auth session captures the global fetch when its module first loads, so
// the stub is installed at load time and tests flip authStub.meStatus instead.
stubAuthFetch();
test("an unconfirmed session has no data owner and no default mode yet", async () => {
  const session: AuthSessionModule = await import("../../auth/auth-session.ts");
  // Given the account service has not answered for this browser yet.
  const loading: AuthState = { user: null, status: null, loading: true, busy: false, error: null };
  // Then the owner seam refuses to guess and no workspace owner is open.
  assert.throws(() => session.resolveAuthDataOwner(loading), AuthError);
  assert.equal(session.peekAuthDataOwner(), null);
});

test("an authenticated account selects the live account workspace by default", async () => {
  authStub.meStatus = 200;
  const session: AuthSessionModule = await import("../../auth/auth-session.ts");
  const runtime: RuntimeModule = await import("../../runtime/index.ts");
  // When a confirmed session reports a signed-in account.
  await session.restoreAuthSession();
  // Then the shared runtime default resolves that account to live persistence.
  assert.equal(session.peekAuthDataOwner(), "account-a");
  assert.equal(runtime.getDefaultDataMode(), "live");
});

test("a signed-out session selects the guest fixture workspace by default", async () => {
  authStub.meStatus = 401;
  const session: AuthSessionModule = await import("../../auth/auth-session.ts");
  const runtime: RuntimeModule = await import("../../runtime/index.ts");
  // When the account service confirms no signed-in user.
  await session.restoreAuthSession();
  // Then the shared runtime default falls back to the guest fixture workspace.
  assert.equal(session.peekAuthDataOwner(), "guest");
  assert.equal(runtime.getDefaultDataMode(), "fixture");
});
