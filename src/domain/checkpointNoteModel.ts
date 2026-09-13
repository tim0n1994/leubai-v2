export interface CheckpointNote {
  readonly id: string;
  readonly verbatim: string;
  readonly channel: "text" | "voice";
  readonly createdAt: string;
}
export function isCheckpointNote(value: unknown): value is CheckpointNote {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "verbatim" in value && typeof value.verbatim === "string" && value.verbatim.trim().length > 0 && value.verbatim.length <= 20000 &&
    "channel" in value && (value.channel === "text" || value.channel === "voice") &&
    "createdAt" in value && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}
