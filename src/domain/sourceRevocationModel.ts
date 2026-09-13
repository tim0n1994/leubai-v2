export type RemoteRevocationOutcome = "pending" | "confirmed" | "failed" | "unknown" | "unavailable";

export interface SourceRevocationReceipt {
  requestedAt: string;
  checkedAt: string | null;
  remoteOutcome: RemoteRevocationOutcome;
  detail: string;
  copyRecallClaim: "none";
}

export function isSourceRevocationReceipt(value: unknown): value is SourceRevocationReceipt {
  if (!value || typeof value !== "object") return false;
  return "requestedAt" in value && typeof value.requestedAt === "string" && Number.isFinite(Date.parse(value.requestedAt)) &&
    "checkedAt" in value && (value.checkedAt === null || typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt))) &&
    "remoteOutcome" in value && typeof value.remoteOutcome === "string" && ["pending", "confirmed", "failed", "unknown", "unavailable"].includes(value.remoteOutcome) &&
    "detail" in value && typeof value.detail === "string" && "copyRecallClaim" in value && value.copyRecallClaim === "none";
}
