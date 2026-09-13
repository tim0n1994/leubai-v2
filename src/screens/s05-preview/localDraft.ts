export type LocalDraft = {
  scope: string;
  planVersion: string;
  title: string;
  status: string;
  sources: string[];
  content: string;
};

export const DRAFT_SOURCES: string[] = [
  "产品说明（示例）",
  "访谈节选（示例）",
];

export type CommitStatus = "committed" | "failed" | "unverified";

export type PendingAttempt<T> = {
  attemptId: string;
  status: Exclude<CommitStatus, "committed">;
  value: T;
};

const pendingStore = new Map<string, PendingAttempt<unknown>>();

export function newAttemptId(): string {
  const runtime = globalThis as { crypto?: Crypto };
  const cryptoRef = runtime.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return (
    "attempt-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

export function isValidAttemptId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function readPendingAttempt<T>(key: string): PendingAttempt<T> | null {
  const attempt = pendingStore.get(key) as PendingAttempt<T> | undefined;
  return attempt ?? null;
}

export function recordPendingAttempt<T>(
  key: string,
  attempt: PendingAttempt<T>,
): void {
  pendingStore.set(key, attempt as PendingAttempt<unknown>);
}

export function clearPendingAttempt(key: string): void {
  pendingStore.delete(key);
}

export function buildReportDraft(): LocalDraft {
  return {
    scope: "本次准备任务",
    planVersion: "方案版本 03",
    title: "报告工作草稿",
    status: "待检查",
    sources: [...DRAFT_SOURCES],
    content: [
      "这份草稿只使用两份指定材料，还没有核对外部信息。",
      "路径 A 保留现有节奏：报告投入从 60 分钟暂估降到 40 分钟。",
      "材料里的数字尚未核对，先列出需要你确认的两点：成本口径、交付时间。",
      "检查通过前，这份草稿不会提交、发送或被引用。",
    ].join("\n"),
  };
}

export function readStored<T>(key: string): T | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readPersisted<T>(key: string): {
  value: T | null;
  corrupted: boolean;
} {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return { value: null, corrupted: false };
  }
  if (raw === null) {
    return { value: null, corrupted: false };
  }
  try {
    return { value: JSON.parse(raw) as T, corrupted: false };
  } catch {
    return { value: null, corrupted: true };
  }
}

export function writeStored<T>(key: string, value: T): boolean {
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function commitStored<T>(key: string, value: T): CommitStatus {
  if (!writeStored(key, value)) {
    return "failed";
  }
  let readBack: T;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return "unverified";
    }
    readBack = JSON.parse(raw) as T;
  } catch {
    return "unverified";
  }
  if (JSON.stringify(readBack) !== JSON.stringify(value)) {
    return "unverified";
  }
  return "committed";
}

export function isValidLocalDraft(value: unknown): value is LocalDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof LocalDraft, unknown>>;
  const sources = candidate.sources;
  return (
    candidate.scope === "本次准备任务" &&
    candidate.planVersion === "方案版本 03" &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    candidate.status === "待检查" &&
    Array.isArray(sources) &&
    sources.length === DRAFT_SOURCES.length &&
    DRAFT_SOURCES.every((source, index) => sources[index] === source) &&
    typeof candidate.content === "string"
  );
}
