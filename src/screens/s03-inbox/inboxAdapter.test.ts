import assert from "node:assert/strict";
import test from "node:test";
import {
  createDomainStore,
  createInitialState,
  FIXTURE_IDS,
} from "../../domain/index.ts";
import type {
  AcceptRequestCommand,
  ArchiveRequestCommand,
  CommandResult,
  DomainCommand,
  DomainState,
  Request,
  UpdateCommitmentCommand,
} from "../../domain/index.ts";
import {
  countCommitmentsForRequest,
  decisionEligibility,
  describeRequestFacts,
  describeSourceRef,
  normalizeCommitmentEdit,
  planInboxRetry,
  requestStatusView,
  selectInboxRequest,
  selectLinkedCommitment,
  selectOrderedRequests,
  verifyCommitmentPatch,
  verifyPersistedRequestStatus,
  verifyRequestStatus,
} from "./inboxAdapter.ts";

const NOW = "2026-09-13T10:00:00+08:00";

let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "uuid-" + uuidSeq;
}

function acceptCommand(requestId: string, revision: number): AcceptRequestCommand {
  commandSeq += 1;
  return {
    type: "acceptRequest",
    commandId: "cmd-" + commandSeq,
    entityId: requestId,
    expectedRevision: revision,
    actor: "user",
    issuedAt: NOW,
  };
}

function archiveCommand(
  requestId: string,
  revision: number,
  decision: "keepIdea" | "exclude",
): ArchiveRequestCommand {
  commandSeq += 1;
  return {
    type: "archiveRequest",
    commandId: "cmd-" + commandSeq,
    entityId: requestId,
    expectedRevision: revision,
    actor: "user",
    issuedAt: NOW,
    decision,
  };
}

function updateCommand(
  commitmentId: string,
  revision: number,
  scope: string | null,
  deadline: string | null,
  effort: number | null,
): UpdateCommitmentCommand {
  commandSeq += 1;
  return {
    type: "updateCommitment",
    commandId: "cmd-" + commandSeq,
    entityId: commitmentId,
    expectedRevision: revision,
    actor: "user",
    issuedAt: NOW,
    scope,
    deadline,
    effortEstimateMinutes: effort,
  };
}

function newStore() {
  return createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: testUuid });
}

function expectOk<C extends DomainCommand>(
  result: CommandResult<C>,
): Extract<CommandResult<C>, { ok: true }>["data"] {
  if (!result.ok) {
    throw new Error("expected ok, got " + result.code + ": " + result.reason);
  }
  return result.data;
}

function expectFail<C extends DomainCommand>(
  result: CommandResult<C>,
): Extract<CommandResult<C>, { ok: false }> {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

test("default selection picks the first real candidate; explicit unknown id fails closed", () => {
  const state = createInitialState("fixture");
  const picked = selectInboxRequest(state, null);
  assert.equal(picked.kind, "selected");
  if (picked.kind !== "selected") return;
  assert.equal(picked.request.id, FIXTURE_IDS.request);
  assert.equal(picked.request.status, "candidate");
  const invalid = selectInboxRequest(state, "missing-request");
  assert.equal(invalid.kind, "invalid");
  if (invalid.kind !== "invalid") return;
  assert.equal(invalid.requestId, "missing-request");
});

test("empty local records stay empty even with an explicit query id", () => {
  const empty = { ...createInitialState("fixture"), requests: {} } satisfies DomainState;
  assert.equal(selectInboxRequest(empty, null).kind, "empty");
  assert.equal(selectInboxRequest(empty, "whatever").kind, "empty");
});

test("ordering is deterministic by createdAt then id", () => {
  const base = createInitialState("fixture");
  const original = base.requests[FIXTURE_IDS.request];
  const later: Request = {
    ...original,
    id: "zz-request",
    createdAt: "2026-09-13T09:00:00+08:00",
    status: "archived",
  };
  const state = {
    ...base,
    requests: { [original.id]: original, [later.id]: later },
  } satisfies DomainState;
  assert.deepEqual(selectOrderedRequests(state).map((r) => r.id), [
    original.id,
    "zz-request",
  ]);
  const picked = selectInboxRequest(state, null);
  if (picked.kind !== "selected") return;
  assert.equal(picked.request.id, original.id);
});

test("unknown readback and pre-accept state never verify as accepted", () => {
  assert.equal(
    verifyPersistedRequestStatus(null, FIXTURE_IDS.request, "accepted"),
    null,
  );
  const before = createInitialState("fixture");
  assert.equal(verifyRequestStatus(before, FIXTURE_IDS.request, "accepted"), false);
  assert.equal(
    verifyPersistedRequestStatus(before, FIXTURE_IDS.request, "accepted"),
    false,
  );
});

test("accepting the candidate creates exactly one commitment", async () => {
  const store = newStore();
  const request = store.getState().requests[FIXTURE_IDS.request];
  const first = expectOk(await store.execute(acceptCommand(request.id, request.revision)));
  const state = store.getState();
  assert.equal(verifyRequestStatus(state, request.id, "accepted"), true);
  assert.equal(countCommitmentsForRequest(state, request.id), 1);
  assert.equal(first.commitment.requestId, request.id);
  assert.equal(first.commitment.scope, null);
  assert.equal(first.commitment.scopeStatus, "pendingDetails");
  assert.equal(first.commitment.deadline, null);
  assert.equal(first.commitment.effortEstimateMinutes, null);
  const linked = selectLinkedCommitment(state, state.requests[request.id]);
  assert.notEqual(linked, null);
  assert.equal(linked?.id, first.commitment.id);
});

test("exact retry and fresh-revision re-accept return the same commitment", async () => {
  const store = newStore();
  const request = store.getState().requests[FIXTURE_IDS.request];
  const command = acceptCommand(request.id, request.revision);
  const first = expectOk(await store.execute(command));
  const retry = expectOk(await store.execute(command));
  assert.equal(retry.commitment.id, first.commitment.id);
  assert.equal(retry.alreadyAccepted, false);
  const refreshed = store.getState().requests[request.id];
  const again = expectOk(await store.execute(acceptCommand(refreshed.id, refreshed.revision)));
  assert.equal(again.alreadyAccepted, true);
  assert.equal(again.commitment.id, first.commitment.id);
  assert.equal(countCommitmentsForRequest(store.getState(), request.id), 1);
});

test("keepIdea and exclude persist without creating a commitment", async () => {
  for (const decision of ["keepIdea", "exclude"] as const) {
    const store = newStore();
    const request = store.getState().requests[FIXTURE_IDS.request];
    const result = expectOk(
      await store.execute(archiveCommand(request.id, request.revision, decision)),
    );
    const expected = decision === "keepIdea" ? "archived" : "excluded";
    assert.equal(result.request.status, expected);
    const state = store.getState();
    assert.equal(verifyRequestStatus(state, request.id, expected), true);
    assert.equal(verifyRequestStatus(state, request.id, "accepted"), false);
    assert.equal(countCommitmentsForRequest(state, request.id), 0);
  }
});

test("stale revision is rejected without silently retrying fresh input", async () => {
  const store = newStore();
  const request = store.getState().requests[FIXTURE_IDS.request];
  expectOk(await store.execute(acceptCommand(request.id, request.revision)));
  const failure = expectFail(await store.execute(archiveCommand(request.id, 1, "keepIdea")));
  assert.equal(failure.code, "REVISION_CONFLICT");
  assert.equal(verifyRequestStatus(store.getState(), request.id, "accepted"), true);
  assert.equal(countCommitmentsForRequest(store.getState(), request.id), 1);
});

test("editing the accepted commitment updates scope deadline and effort", async () => {
  const store = newStore();
  const request = store.getState().requests[FIXTURE_IDS.request];
  const accepted = expectOk(await store.execute(acceptCommand(request.id, request.revision)));
  const commitmentId = accepted.commitment.id;
  const first = expectOk(
    await store.execute(updateCommand(commitmentId, accepted.commitment.revision, "写周报复盘草稿", "2026-09-20", 45)),
  );
  assert.equal(first.commitment.scopeStatus, "clarified");
  assert.equal(
    verifyCommitmentPatch(store.getState(), commitmentId, {
      scope: "写周报复盘草稿",
      deadline: "2026-09-20",
      effortEstimateMinutes: 45,
    }),
    true,
  );
  const second = expectOk(
    await store.execute(updateCommand(commitmentId, first.commitment.revision, null, null, null)),
  );
  assert.equal(second.commitment.scope, null);
  assert.equal(second.commitment.scopeStatus, "pendingDetails");
  assert.equal(second.commitment.deadline, null);
  assert.equal(second.commitment.effortEstimateMinutes, null);
});

test("empty edit input stays unknown instead of inventing defaults", () => {
  assert.deepEqual(normalizeCommitmentEdit({ scope: "", deadline: "", effort: "" }), {
    ok: true,
    patch: { scope: null, deadline: null, effortEstimateMinutes: null },
  });
  assert.deepEqual(
    normalizeCommitmentEdit({ scope: "  周报  ", deadline: "2026-09-30", effort: "45" }),
    {
      ok: true,
      patch: { scope: "周报", deadline: "2026-09-30", effortEstimateMinutes: 45 },
    },
  );
});

test("effort input validation rejects zero, negative, fractional, and non-numeric input", () => {
  for (const bad of ["0", "-3", "2.5", "abc", "1e3"]) {
    const result = normalizeCommitmentEdit({ scope: "", deadline: "", effort: bad });
    assert.equal(result.ok, false, "expected rejection for effort " + bad);
  }
});

test("deadline input validation rejects impossible or malformed dates", () => {
  assert.equal(normalizeCommitmentEdit({ scope: "", deadline: "2026-02-30", effort: "" }).ok, false);
  assert.equal(normalizeCommitmentEdit({ scope: "", deadline: "明天", effort: "" }).ok, false);
  assert.equal(normalizeCommitmentEdit({ scope: "", deadline: "2026-13-01", effort: "" }).ok, false);
  assert.deepEqual(normalizeCommitmentEdit({ scope: "", deadline: "2026-09-30", effort: "" }), {
    ok: true,
    patch: { scope: null, deadline: "2026-09-30", effortEstimateMinutes: null },
  });
});

test("candidate facts keep unknown fields honest", () => {
  const state = createInitialState("fixture");
  const request = state.requests[FIXTURE_IDS.request];
  const facts = describeRequestFacts(state, request);
  assert.deepEqual(
    facts.map((fact) => [fact.label, fact.value]),
    [
      ["提出者", "同事·陈"],
      ["谁已接受", "尚未确认"],
      ["截止期限", "尚未约定"],
      ["预计投入", "尚未估计"],
    ],
  );
  assert.deepEqual(facts.map((fact) => fact.unknown), [false, true, true, true]);
});

test("accepted request shows the real acceptor without inventing deadline or effort", async () => {
  const store = newStore();
  const request = store.getState().requests[FIXTURE_IDS.request];
  expectOk(await store.execute(acceptCommand(request.id, request.revision)));
  const state = store.getState();
  const facts = describeRequestFacts(state, state.requests[request.id]);
  assert.deepEqual(
    facts.map((fact) => [fact.label, fact.value, fact.unknown]),
    [
      ["提出者", "同事·陈", false],
      ["谁已接受", "本人", false],
      ["截止期限", "尚未约定", true],
      ["预计投入", "尚未估计", true],
    ],
  );
});

test("sourceRef renders the real reference without fabricating links", () => {
  const state = createInitialState("fixture");
  const request = state.requests[FIXTURE_IDS.request];
  const refView = describeSourceRef(request);
  assert.equal(refView.kind, "ref");
  if (refView.kind !== "ref") return;
  assert.equal(refView.label, "im://dm/42");
  const noSource: Request = { ...request, sourceRef: null };
  assert.equal(describeSourceRef(noSource).kind, "unknown");
  const emptySource: Request = { ...request, sourceRef: "  " };
  assert.equal(describeSourceRef(emptySource).kind, "unknown");
  const web: Request = { ...request, sourceRef: "https://example.com/a" };
  const webView = describeSourceRef(web);
  assert.equal(webView.kind, "link");
  if (webView.kind !== "link") return;
  assert.equal(webView.href, "https://example.com/a");
});

test("eligibility allows decisions only for candidates and editing only after acceptance", async () => {
  const state = createInitialState("fixture");
  const candidate = state.requests[FIXTURE_IDS.request];
  assert.deepEqual(decisionEligibility(candidate), {
    canAccept: true,
    canKeepIdea: true,
    canExclude: true,
    canEditCommitment: false,
  });
  const store = newStore();
  expectOk(await store.execute(acceptCommand(candidate.id, candidate.revision)));
  const acceptedRequest = store.getState().requests[candidate.id];
  assert.deepEqual(decisionEligibility(acceptedRequest), {
    canAccept: false,
    canKeepIdea: false,
    canExclude: false,
    canEditCommitment: true,
  });
});

test("status labels cover all four persisted statuses", () => {
  assert.equal(requestStatusView({ ...seedCandidate(), status: "candidate" }).pill, "请求 · 未确认");
  assert.equal(requestStatusView({ ...seedCandidate(), status: "accepted" }).pill, "已接受 · 本地责任");
  assert.equal(requestStatusView({ ...seedCandidate(), status: "archived" }).pill, "已保留为想法");
  assert.equal(requestStatusView({ ...seedCandidate(), status: "excluded" }).pill, "已排除 · 不进入计划");
});

function seedCandidate(): Request {
  return createInitialState("fixture").requests[FIXTURE_IDS.request];
}

test("retry plans separate exact replay from explicit recapture", () => {
  assert.equal(planInboxRetry("REVISION_CONFLICT"), "recapture");
  assert.equal(planInboxRetry("STORAGE_WRITE_FAILED"), "replayExact");
  assert.equal(planInboxRetry("INVALID_TRANSITION"), "replayExact");
});
