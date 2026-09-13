// Pure adapter seam: must stay free of React/DOM/runtime imports so node --experimental-strip-types can run the focused lifecycle tests.
import { bindingHash } from "../../domain/hash.ts";
import type {
  CaptureDraft,
  CaptureChannel,
  CheckConflictCommand,
  DomainState,
  EntityId,
  Intent,
  ParsedFields,
  SaveCaptureDraftCommand,
  SaveIntentCommand,
  TimeRange,
} from "../../domain/types.ts";

export type Fields = {
  dateText: string;
  start: string;
  end: string;
  constraint: string;
};

export type DraftState = {
  verbatim: string;
  fields: Fields;
};

export type Interval = { date: string; start: string; end: string };

export type CaptureTarget = {
  id: EntityId;
  revision: number;
  status: "open" | "savedAsIntent";
};

export type ConstraintInput = { kind: string; expression: string; confirmed: boolean };

export type DraftReadback =
  | { ok: true; captureDraft: CaptureDraft }
  | { ok: false; reason: string };

export type IntentReadback =
  | { ok: true; intent: Intent; captureDraft: CaptureDraft | null }
  | { ok: false; reason: string };

export type RestoredView =
  | { kind: "open"; draft: DraftState; target: CaptureTarget }
  | { kind: "completed"; draft: DraftState; target: CaptureTarget; intentId: EntityId | null }
  | { kind: "intentSnapshot"; draft: DraftState };

const DEMO_TODAY = "2026-09-12";

const ZH_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const TIME_PATTERN =
  /([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:点|:|：)\s*(半|[0-9]{1,2})?分?/g;

const CONSTRAINT_PATTERN =
  /([^\s，。,、！？；;：:]{2,12}?)(?:别动|不能动|不要动|不许动|别改|不能改)/;

const CLOCK_PATTERN = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

const issuedAtByCommandId = new Map<string, string>();

export function issuedAtFor(commandId: string): string {
  const memoized = issuedAtByCommandId.get(commandId);
  if (memoized !== undefined) return memoized;
  const issuedAt = new Date().toISOString();
  issuedAtByCommandId.set(commandId, issuedAt);
  return issuedAt;
}

function zhDigitAt(text: string, index: number): number | null {
  const value: number | undefined = ZH_DIGITS[text[index] ?? ""];
  return value === undefined ? null : value;
}

function zhNumberToValue(text: string): number | null {
  if (/^[0-9]{1,2}$/.test(text)) return Number(text);
  if (!/^[零一二两三四五六七八九十]{1,3}$/.test(text)) return null;
  if (text === "十") return 10;
  const tenIndex = text.indexOf("十");
  if (tenIndex === -1) return zhDigitAt(text, 0);
  const tens = tenIndex === 0 ? 1 : zhDigitAt(text, tenIndex - 1);
  const ones = tenIndex === text.length - 1 ? 0 : zhDigitAt(text, tenIndex + 1);
  if (tens === null || ones === null) return null;
  return tens * 10 + ones;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function clockFrom(hour: number, minute: number): string {
  return pad2(hour) + ":" + pad2(minute);
}

function parseTimes(text: string): string[] {
  const times: string[] = [];
  const eveningContext = /晚|下午|傍晚/.test(text);
  for (const match of text.matchAll(TIME_PATTERN)) {
    const hourValue = zhNumberToValue(match[1] ?? "");
    if (hourValue === null || hourValue > 23) continue;
    const minutePart: string | undefined = match[2];
    let minute = 0;
    if (minutePart !== undefined) {
      if (minutePart === "半") {
        minute = 30;
      } else {
        const value = Number(minutePart);
        if (!Number.isInteger(value) || value > 59) continue;
        minute = value;
      }
    }
    let hour = hourValue;
    if (eveningContext && hour < 12) hour += 12;
    times.push(clockFrom(hour, minute));
  }
  return times;
}

export function formatDisplayDate(iso: string): string {
  const parts = iso.split("-");
  const month = Number(parts[1] ?? "0");
  const day = Number(parts[2] ?? "0");
  return month + " 月 " + day + " 日";
}

export function parseDateText(text: string): string | null {
  const explicit = text.match(
    /([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*月\s*([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*[日号]?/,
  );
  if (explicit) {
    const month = zhNumberToValue(explicit[1] ?? "");
    const day = zhNumberToValue(explicit[2] ?? "");
    if (
      month !== null &&
      day !== null &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return "2026-" + pad2(month) + "-" + pad2(day);
    }
  }
  if (text.includes("后天")) return "2026-09-14";
  if (text.includes("明晚") || text.includes("明天")) return "2026-09-13";
  if (text.includes("今晚") || text.includes("今天")) return DEMO_TODAY;
  return null;
}

export function parseConstraint(text: string): string {
  const match = text.match(CONSTRAINT_PATTERN);
  return match?.[1] ?? "";
}

export function parseSentence(text: string): Fields {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { dateText: "", start: "", end: "", constraint: "" };
  }
  const times = parseTimes(trimmed);
  const dateIso = parseDateText(trimmed);
  return {
    dateText: dateIso === null ? "" : formatDisplayDate(dateIso),
    start: times[0] ?? "",
    end: times[1] ?? "",
    constraint: parseConstraint(trimmed),
  };
}

export function toMinutes(clock: string): number | null {
  const match = clock.trim().match(CLOCK_PATTERN);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeClock(value: string): string | null {
  const match = value.trim().match(CLOCK_PATTERN);
  if (match === null) return null;
  return pad2(Number(match[1])) + ":" + match[2];
}

export function isRealCalendarDate(iso: string): boolean {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function resolveDateIso(text: string): string | null {
  const iso = parseDateText(text.trim());
  if (iso === null || !isRealCalendarDate(iso)) return null;
  return iso;
}

export function intervalKey(interval: Interval): string {
  return interval.date + "|" + interval.start + "|" + interval.end;
}

export function intervalRange(interval: Interval): TimeRange {
  return {
    start: interval.date + "T" + interval.start + ":00+08:00",
    end: interval.date + "T" + interval.end + ":00+08:00",
    timezone: "Asia/Shanghai",
  };
}

export function validateInterval(
  fields: Fields,
): { ok: true; interval: Interval } | { ok: false; title: string; note: string } {
  const date = resolveDateIso(fields.dateText);
  const start = normalizeClock(fields.start);
  const end = normalizeClock(fields.end);
  if (date === null || start === null || end === null) {
    const unresolved: string[] = [];
    if (date === null) {
      unresolved.push(
        fields.dateText.trim() === "" ? "日期" : "日期「" + fields.dateText.trim() + "」",
      );
    }
    if (start === null) {
      unresolved.push(
        fields.start.trim() === "" ? "开始时间" : "开始时间「" + fields.start.trim() + "」",
      );
    }
    if (end === null) {
      unresolved.push(
        fields.end.trim() === "" ? "结束时间" : "结束时间「" + fields.end.trim() + "」",
      );
    }
    return {
      ok: false,
      title: "无法判断 · 信息不完整",
      note:
        unresolved.join("、") +
        "未识别为有效值；日期须是真实日历日期，时间须是 24 小时制 HH:MM。不会沿用默认值，可用「修改字段」手动补全。",
    };
  }
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return {
      ok: false,
      title: "无法检查：结束时间需要晚于开始时间。",
      note: "当前 " + start + "—" + end + " 不构成有效时段；不会沿用默认值。",
    };
  }
  return { ok: true, interval: { date, start, end } };
}

export function snapshotParsedFields(fields: Fields): ParsedFields {
  const date = resolveDateIso(fields.dateText);
  const start = normalizeClock(fields.start);
  const end = normalizeClock(fields.end);
  return {
    date,
    startTime: start,
    endTime: end,
    timezone:
      date !== null && start !== null && end !== null ? "Asia/Shanghai" : null,
    topic: null,
  };
}

export function parsedFieldsEqual(a: ParsedFields, b: ParsedFields): boolean {
  return (
    a.date === b.date &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.timezone === b.timezone &&
    a.topic === b.topic
  );
}

export function sameDraftState(a: DraftState, b: DraftState): boolean {
  return (
    a.verbatim === b.verbatim &&
    a.fields.dateText === b.fields.dateText &&
    a.fields.start === b.fields.start &&
    a.fields.end === b.fields.end &&
    a.fields.constraint === b.fields.constraint
  );
}

export function constraintsFromField(raw: string, constraintText: string): ConstraintInput[] {
  const trimmed = constraintText.trim();
  if (trimmed === "") return [];
  return [
    {
      kind: trimmed === parseConstraint(raw) ? "raw" : "manual",
      expression: trimmed,
      confirmed: true,
    },
  ];
}

function linkedTarget(target: CaptureTarget | null): {
  entityId: EntityId;
  expectedRevision: number;
} | null {
  if (target === null || target.status !== "open") return null;
  return { entityId: target.id, expectedRevision: target.revision };
}

export function buildCaptureDraftCommand(input: {
  submitted: DraftState;
  target: CaptureTarget | null;
  channel?: CaptureChannel;
}): SaveCaptureDraftCommand {
  const parsedFields = snapshotParsedFields(input.submitted.fields);
  const constraints = constraintsFromField(
    input.submitted.verbatim,
    input.submitted.fields.constraint,
  );
  const link = linkedTarget(input.target);
  const commandId =
    "s14-draft-" +
    bindingHash({
      kind: "s14-capture-draft",
      channel: input.channel ?? "shortcut",
      raw: input.submitted.verbatim,
      parsedFields,
      constraints,
      targetId: input.target?.id ?? null,
      targetRevision: input.target?.revision ?? null,
    });
  return {
    type: "saveCaptureDraft",
    commandId,
    entityId: link?.entityId ?? null,
    expectedRevision: link?.expectedRevision ?? null,
    actor: "user",
    issuedAt: issuedAtFor(commandId),
    channel: input.channel ?? "shortcut",
    raw: input.submitted.verbatim,
    parsedFields,
    constraints,
  };
}

export function buildIntentCommand(input: {
  submitted: DraftState;
  interval: Interval;
  target: CaptureTarget | null;
  channel?: CaptureChannel;
}): SaveIntentCommand {
  const isFieldOnly = input.submitted.verbatim === "";
  const raw = isFieldOnly ? "" : input.submitted.verbatim;
  const constraints = constraintsFromField(
    input.submitted.verbatim,
    input.submitted.fields.constraint,
  );
  const link = linkedTarget(input.target);
  const parsedFields: ParsedFields = {
    date: input.interval.date,
    startTime: input.interval.start,
    endTime: input.interval.end,
    timezone: "Asia/Shanghai",
    topic: null,
  };
  const commandId =
    "s14-intent-" +
    bindingHash({
      kind: "s14-capture-intent",
      channel: isFieldOnly ? "manual" : (input.channel ?? "shortcut"),
      raw,
      parsedFields,
      constraints,
      targetId: input.target?.id ?? null,
      targetRevision: input.target?.revision ?? null,
    });
  return {
    type: "saveIntent",
    commandId,
    entityId: link?.entityId ?? null,
    expectedRevision: link?.expectedRevision ?? null,
    actor: "user",
    issuedAt: issuedAtFor(commandId),
    raw,
    channel: isFieldOnly ? "manual" : (input.channel ?? "shortcut"),
    parsedFields,
    constraints,
  };
}

export function buildCheckConflictCommand(input: {
  interval: Interval;
  sharedRevision: number;
}): CheckConflictCommand {
  const range = intervalRange(input.interval);
  const commandId =
    "s14-check-" +
    bindingHash({ kind: "s14-capture-check", range, sharedRevision: input.sharedRevision });
  return {
    type: "checkConflict",
    commandId,
    entityId: null,
    expectedRevision: null,
    actor: "user",
    issuedAt: issuedAtFor(commandId),
    range,
  };
}

export function verifyDraftReadback(
  state: DomainState,
  command: SaveCaptureDraftCommand,
  data: { captureDraft: CaptureDraft },
): DraftReadback {
  const record = state.captureDrafts[data.captureDraft.id];
  if (record === undefined) {
    return { ok: false, reason: "草稿不在共享状态中" };
  }
  if (record.raw !== command.raw) {
    return { ok: false, reason: "草稿原文与提交内容不一致" };
  }
  if (record.status !== "open") {
    return { ok: false, reason: "草稿状态不是 open：" + record.status };
  }
  for (const [key, value] of Object.entries(command.parsedFields ?? {})) {
    if (record.parsedFields[key as keyof ParsedFields] !== value) {
      return { ok: false, reason: "草稿字段 " + key + " 与提交内容不一致" };
    }
  }
  if (command.constraints !== undefined) {
    if (JSON.stringify(record.constraints ?? []) !== JSON.stringify(command.constraints)) {
      return { ok: false, reason: "草稿约束与提交内容不一致" };
    }
  }
  return { ok: true, captureDraft: record };
}

export function verifyIntentReadback(
  state: DomainState,
  command: SaveIntentCommand,
  data: { intent: Intent; captureDraft?: CaptureDraft },
): IntentReadback {
  const intent = state.intents[data.intent.id];
  if (intent === undefined) {
    return { ok: false, reason: "意图不在共享状态中" };
  }
  if (intent.verbatim !== command.raw) {
    return { ok: false, reason: "意图原文与提交内容不一致" };
  }
  if (intent.channel !== command.channel) {
    return { ok: false, reason: "意图通道与提交不一致：" + intent.channel };
  }
  for (const [key, value] of Object.entries(command.parsedFields ?? {})) {
    if (intent.parsedFields[key as keyof ParsedFields] !== value) {
      return { ok: false, reason: "意图字段 " + key + " 与提交内容不一致" };
    }
  }
  const expectedExpressions = (command.constraints ?? []).map((entry) => entry.expression);
  if (
    JSON.stringify(intent.constraints.map((entry) => entry.expression)) !==
    JSON.stringify(expectedExpressions)
  ) {
    return { ok: false, reason: "意图约束与提交内容不一致" };
  }
  if (command.entityId !== null) {
    const completed = data.captureDraft;
    if (completed === undefined) {
      return { ok: false, reason: "链接保存未返回捕获草稿完成结果" };
    }
    if (completed.id !== command.entityId) {
      return { ok: false, reason: "完成的捕获草稿不是提交目标 " + command.entityId };
    }
    const record = state.captureDrafts[completed.id];
    if (record === undefined || record.status !== "savedAsIntent") {
      return { ok: false, reason: "捕获草稿未在共享状态中确认为已保存意图" };
    }
    if (record.intentId !== intent.id) {
      return { ok: false, reason: "捕获草稿的意图链接与返回意图不一致" };
    }
    return { ok: true, intent, captureDraft: record };
  }
  if (data.captureDraft !== undefined) {
    return { ok: false, reason: "独立保存意外返回了捕获草稿链接" };
  }
  return { ok: true, intent, captureDraft: null };
}

export function viewFromDraftRecord(record: CaptureDraft): RestoredView {
  const parsed = record.parsedFields;
  const draft: DraftState = {
    verbatim: record.raw,
    fields: {
      dateText:
        parsed.date !== null && isRealCalendarDate(parsed.date)
          ? formatDisplayDate(parsed.date)
          : "",
      start: parsed.startTime ?? "",
      end: parsed.endTime ?? "",
      constraint:
        record.constraints !== undefined && record.constraints.length > 0
          ? record.constraints.map((entry) => entry.expression).join("、")
          : parseConstraint(record.raw),
    },
  };
  const target: CaptureTarget = { id: record.id, revision: record.revision, status: record.status === "open" ? "open" : "savedAsIntent" };
  if (record.status === "open") {
    return { kind: "open", draft, target };
  }
  return { kind: "completed", draft, target, intentId: record.intentId ?? null };
}

export function viewFromIntent(intent: Intent): RestoredView {
  const parsed = intent.parsedFields;
  return {
    kind: "intentSnapshot",
    draft: {
      verbatim: intent.verbatim,
      fields: {
        dateText:
          parsed.date !== null && isRealCalendarDate(parsed.date)
            ? formatDisplayDate(parsed.date)
            : "",
        start: parsed.startTime ?? "",
        end: parsed.endTime ?? "",
        constraint: intent.constraints.map((entry) => entry.expression).join("、"),
      },
    },
  };
}

export function findMatchingIntent(state: DomainState, draft: DraftState, channel: CaptureChannel = "shortcut"): Intent | null {
  const raw = draft.verbatim.trim();
  if (raw === "") return null;
  const verdict = validateInterval(draft.fields);
  if (!verdict.ok) return null;
  const manualConstraint = draft.fields.constraint.trim();
  const expectedConstraintKey = manualConstraint === "" ? "" : manualConstraint;
  for (const intent of Object.values(state.intents)) {
    if (intent.status !== "saved") continue;
    if (intent.channel !== channel) continue;
    if (intent.verbatim.trim() !== raw) continue;
    if (intent.parsedFields.date !== verdict.interval.date) continue;
    if (intent.parsedFields.startTime !== verdict.interval.start) continue;
    if (intent.parsedFields.endTime !== verdict.interval.end) continue;
    if (intent.parsedFields.timezone !== "Asia/Shanghai") continue;
    const intentConstraintKey = intent.constraints
      .map((entry) => entry.expression)
      .sort()
      .join("|");
    if (intentConstraintKey !== expectedConstraintKey) continue;
    return intent;
  }
  return null;
}
