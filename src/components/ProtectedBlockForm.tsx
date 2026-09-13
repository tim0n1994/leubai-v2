import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { defaultUuid } from "../domain/ids.ts";
import type { DomainStore } from "../domain/store.ts";
import type { CreateProtectedBlockCommand, DomainState, ProtectedBlock } from "../domain/types.ts";
import { saveProtectedBlock } from "./protected-block-form.ts";
import "./protected-block-form.css";

export interface ProtectedBlockFormProps {
  store: DomainStore;
  readPersistedState: () => DomainState | null;
  intentId?: string | null;
  initialDate?: string;
  onCreated?: (block: ProtectedBlock) => void;
}

export function ProtectedBlockForm({ store, readPersistedState, intentId = null, initialDate = "", onCreated }: ProtectedBlockFormProps) {
  const id = useId();
  const alive = useRef(true);
  const mutex = useRef(false);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timezone, setTimezone] = useState(store.getState().ruleset.timezone);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CreateProtectedBlockCommand | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<ProtectedBlock | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutex.current || saved) return;
    mutex.current = true;
    setBusy(true);
    setReason("");
    const command = pending ?? { type: "createProtectedBlock", commandId: defaultUuid(), blockId: defaultUuid(), entityId: null, expectedRevision: null, actor: "user", issuedAt: new Date().toISOString(), intentId, date, startTime, endTime, timezone, purpose: purpose.trim() ? purpose : null } satisfies CreateProtectedBlockCommand;
    const result = await saveProtectedBlock(store, readPersistedState, command);
    mutex.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) {
      setPending(result.retryExact ? command : null);
      setReason(result.reason);
      return;
    }
    setPending(null);
    setSaved(result.block);
    onCreated?.(result.block);
  }

  return <section className="protected-block-form" aria-label="设置保护时间">
    <button type="button" className="protected-block-form__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? "收起保护时间设置" : "设置一段保护时间"}</button>
    {open && <div id={id} className="protected-block-form__body">
      <p>给自己留一段时间，用途可以暂时空着。仅保存在本地，不写入外部日历；外部覆盖仍未知。已有待执行方案需要重新确认。</p>
      {saved ? <div role="status" className="protected-block-form__receipt"><strong>保护时间已保存并读回确认</strong><p>{saved.range.start.slice(0, 10)} · {saved.range.start.slice(11, 16)}—{saved.range.end.slice(11, 16)} · {saved.range.timezone}</p><p>{saved.purpose ?? "暂不设用途"} · {saved.intentId ? "关联已有意图" : "独立保护时段"} · 未写入外部日历</p></div> : <form onSubmit={submit}>
        <fieldset disabled={busy || pending !== null}>
          <legend className="protected-block-form__legend">保护时段</legend>
          <div className="protected-block-form__grid">
            <label>日期<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
            <label>开始时间<input type="time" required value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
            <label>结束时间<input type="time" required value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
          </div>
          <label>时区（IANA）<input type="text" required value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="Asia/Shanghai" autoCapitalize="none" spellCheck={false} /></label>
          <label>用途（可留空）<input type="text" maxLength={2000} value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="暂时不需要命名" /></label>
        </fieldset>
        {reason && <p role="alert" className="protected-block-form__error">{reason}</p>}
        <button type="submit" className="protected-block-form__save" disabled={busy}>{busy ? "正在保存并读回…" : pending ? "重试同一记录" : "确认保存保护时间"}</button>
      </form>}
    </div>}
  </section>;
}
