import type {
  Commitment,
  DomainState,
  EntityId,
  Request,
} from "../../domain/types.ts";

export type InboxSelection =
  | { kind: "empty" }
  | { kind: "invalid"; requestId: string }
  | { kind: "selected"; request: Request };

export function selectOrderedRequests(state: DomainState): Request[] {
  return Object.values(state.requests).sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });
}

export function selectInboxRequest(
  state: DomainState,
  requestIdQuery: string | null,
): InboxSelection {
  const ordered = selectOrderedRequests(state);
  if (ordered.length === 0) return { kind: "empty" };
  if (requestIdQuery !== null) {
    const found = state.requests[requestIdQuery];
    if (!found) return { kind: "invalid", requestId: requestIdQuery };
    return { kind: "selected", request: found };
  }
  const firstCandidate = ordered.find((request) => request.status === "candidate");
  return { kind: "selected", request: firstCandidate ?? ordered[0] };
}

export interface RequestStatusView {
  pill: string;
  listTag: string;
  note: string | null;
}

export function requestStatusView(request: Request): RequestStatusView {
  switch (request.status) {
    case "candidate":
      return { pill: "请求 · 未确认", listTag: "尚未接受", note: null };
    case "accepted":
      return {
        pill: "已接受 · 本地责任",
        listTag: "已接受",
        note: "本地责任已建立，未对外发送",
      };
    case "archived":
      return { pill: "已保留为想法", listTag: "已保留为想法", note: "未成为责任" };
    case "excluded":
      return { pill: "已排除 · 不进入计划", listTag: "已排除", note: "没有对外回复" };
  }
}

export function selectLinkedCommitment(
  state: DomainState,
  request: Request,
): Commitment | null {
  if (request.commitmentId === null) return null;
  const commitment = state.commitments[request.commitmentId];
  if (!commitment || commitment.requestId !== request.id) return null;
  return commitment;
}

export function countCommitmentsForRequest(
  state: DomainState,
  requestId: EntityId,
): number {
  return Object.values(state.commitments).filter(
    (commitment) => commitment.requestId === requestId,
  ).length;
}

function acceptedByLabel(acceptedBy: string): string {
  return acceptedBy === "user" ? "本人" : acceptedBy;
}

export interface RequestFact {
  label: string;
  value: string;
  unknown: boolean;
}

export function describeRequestFacts(
  state: DomainState,
  request: Request,
): RequestFact[] {
  const commitment = selectLinkedCommitment(state, request);
  const deadline = commitment?.deadline ?? null;
  const effort = commitment?.effortEstimateMinutes ?? null;
  return [
    {
      label: "提出者",
      value: request.proposer ?? "未知",
      unknown: request.proposer === null,
    },
    {
      label: "谁已接受",
      value: request.acceptedBy === null ? "尚未确认" : acceptedByLabel(request.acceptedBy),
      unknown: request.acceptedBy === null,
    },
    {
      label: "截止期限",
      value: deadline ?? "尚未约定",
      unknown: deadline === null,
    },
    {
      label: "预计投入",
      value: effort === null ? "尚未估计" : String(effort) + " 分钟",
      unknown: effort === null,
    },
  ];
}

export type SourceRefView =
  | { kind: "unknown"; label: string }
  | { kind: "ref"; label: string }
  | { kind: "link"; label: string; href: string };

export function describeSourceRef(request: Request): SourceRefView {
  const ref = request.sourceRef;
  if (ref === null || ref.trim() === "") {
    return { kind: "unknown", label: "来源未记录" };
  }
  if (/^https?:\/\//i.test(ref)) {
    return { kind: "link", label: ref, href: ref };
  }
  return { kind: "ref", label: ref };
}

export interface DecisionEligibility {
  canAccept: boolean;
  canKeepIdea: boolean;
  canExclude: boolean;
  canEditCommitment: boolean;
}

export function decisionEligibility(request: Request): DecisionEligibility {
  const isCandidate = request.status === "candidate";
  return {
    canAccept: isCandidate,
    canKeepIdea: isCandidate,
    canExclude: isCandidate,
    canEditCommitment: request.status === "accepted",
  };
}

export type DecidedStatus = "accepted" | "archived" | "excluded";

export function verifyRequestStatus(
  state: DomainState,
  requestId: EntityId,
  expected: DecidedStatus,
): boolean {
  const request = state.requests[requestId];
  if (!request || request.status !== expected) return false;
  if (expected === "accepted") {
    return request.commitmentId !== null && countCommitmentsForRequest(state, requestId) === 1;
  }
  return countCommitmentsForRequest(state, requestId) === 0;
}

export function verifyPersistedRequestStatus(
  persisted: DomainState | null,
  requestId: EntityId,
  expected: DecidedStatus,
): boolean | null {
  if (persisted === null) return null;
  return verifyRequestStatus(persisted, requestId, expected);
}

export type InboxRetryPlan = "replayExact" | "recapture";

export function planInboxRetry(failureCode: string): InboxRetryPlan {
  return failureCode === "REVISION_CONFLICT" ? "recapture" : "replayExact";
}

export interface CommitmentEditPatch {
  scope: string | null;
  deadline: string | null;
  effortEstimateMinutes: number | null;
}

export type CommitmentEditResult =
  | { ok: true; patch: CommitmentEditPatch }
  | { ok: false; errors: string[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EFFORT_PATTERN = /^\d+$/;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function normalizeCommitmentEdit(input: {
  scope: string;
  deadline: string;
  effort: string;
}): CommitmentEditResult {
  const errors: string[] = [];
  const scopeText = input.scope.trim();
  const scope = scopeText === "" ? null : scopeText;
  let deadline: string | null = null;
  const deadlineText = input.deadline.trim();
  if (deadlineText !== "") {
    if (!isValidCalendarDate(deadlineText)) {
      errors.push("截止日期需要是真实存在的日期，或留空表示尚未约定。");
    } else {
      deadline = deadlineText;
    }
  }
  let effort: number | null = null;
  const effortText = input.effort.trim();
  if (effortText !== "") {
    const parsed = EFFORT_PATTERN.test(effortText) ? Number(effortText) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push("预计投入需要是正整数分钟，或留空表示尚未估计。");
    } else {
      effort = parsed;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, patch: { scope, deadline, effortEstimateMinutes: effort } };
}

export function verifyCommitmentPatch(
  state: DomainState,
  commitmentId: EntityId,
  patch: CommitmentEditPatch,
): boolean {
  const commitment = state.commitments[commitmentId];
  if (!commitment) return false;
  return (
    commitment.scope === patch.scope &&
    commitment.deadline === patch.deadline &&
    commitment.effortEstimateMinutes === patch.effortEstimateMinutes
  );
}
