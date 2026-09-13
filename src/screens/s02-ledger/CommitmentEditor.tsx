import { useState, type FormEvent } from "react";
import type { Commitment, SaveLocalCommitmentCommand } from "../../domain/types.ts";
import { formatMinuteOfDay } from "../s01-now/timeSurfaces.ts";

export function CommitmentEditor({ store, commitment, date, onClose }: { store: import("../../domain/store.ts").DomainStore; commitment: Commitment | null; date: string; onClose: () => void }) {
  const [scope, setScope] = useState(commitment?.scope ?? "");
  const [scheduled, setScheduled] = useState(!!commitment?.schedule || !commitment);
  const [startDate, setStartDate] = useState(commitment?.schedule?.date ?? date);
  const [endDate, setEndDate] = useState(commitment?.schedule?.endDate ?? commitment?.schedule?.date ?? date);
  const [start, setStart] = useState(formatMinuteOfDay(commitment?.schedule?.startMinute ?? 540));
  const [end, setEnd] = useState(formatMinuteOfDay(commitment?.schedule?.endMinute ?? 600));
  const [allDay, setAllDay] = useState(commitment?.schedule?.allDay ?? false);
  const [timezone, setTimezone] = useState(commitment?.schedule?.timezone ?? store.getState().ruleset.timezone);
  const [effort, setEffort] = useState(commitment?.effortEstimateMinutes?.toString() ?? "");
  const [mobility, setMobility] = useState<"fixed" | "flexible">(commitment?.mobility ?? "flexible");
  const [status, setStatus] = useState(commitment?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<SaveLocalCommitmentCommand | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const command: SaveLocalCommitmentCommand = pending ?? { type: "saveLocalCommitment", commandId: crypto.randomUUID(), entityId: commitment?.id ?? null, expectedRevision: commitment?.revision ?? null, actor: "user", issuedAt: new Date().toISOString(), scope, effortEstimateMinutes: effort === "" ? null : Number(effort), mobility, status, schedule: scheduled ? { date: startDate, endDate, startMinute: allDay ? null : minute(start), endMinute: allDay ? null : minute(end), timezone, allDay } : null };
    setSaving(true);
    setError("");
    try {
      const result = await store.execute(command);
      if (result.ok) onClose();
      else {
        setError(result.reason);
        setPending(result.retryable ? command : null);
      }
    } catch { setError("保存结果尚未确认，请重试相同保存。"); setPending(command); }
    finally { setSaving(false); }
  };
  return <form className="s02-editor" onSubmit={submit} aria-label={commitment ? "编辑责任与安排" : "新增责任与安排"}>
    <h3>{commitment ? "编辑责任与安排" : "新增责任与安排"}</h3>
    <fieldset disabled={saving || pending !== null}>
      <label>责任名称<input required maxLength={2000} value={scope} onChange={event => setScope(event.target.value)} /></label>
      <label>预计投入（分钟，留空表示未知）<input type="number" min="1" step="1" value={effort} onChange={event => setEffort(event.target.value)} /></label>
      <label>机动性<select value={mobility} onChange={event => setMobility(event.target.value as "fixed" | "flexible")}><option value="flexible">可变计划</option><option value="fixed">固定约定</option></select></label>
      <label>责任状态<select value={status} onChange={event => setStatus(event.target.value as Commitment["status"])}><option value="active">进行中／重新打开</option><option value="done">本人已标记完成</option><option value="cancelled">已取消</option><option value="deferred">待重新安排</option></select></label>
      <label className="s02-editor-check"><input type="checkbox" checked={scheduled} onChange={event => setScheduled(event.target.checked)} />安排时间（取消勾选仅移除安排，保留责任）</label>
      {scheduled && <>
        <label className="s02-editor-check"><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} />全天</label>
        <label>开始日期<input required type="date" value={startDate} onChange={event => { setStartDate(event.target.value); if (event.target.value > endDate) setEndDate(event.target.value); }} /></label>
        <label>结束日期（全天包含此日）<input required type="date" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        {!allDay && <><label>开始时间<input required type="time" value={start} onChange={event => setStart(event.target.value)} /></label><label>结束时间<input required type="time" value={end} onChange={event => setEnd(event.target.value)} /></label></>}
        <label>安排时区<input required value={timezone} onChange={event => setTimezone(event.target.value)} /></label>
      </>}
    </fieldset>
    <p>只保存私人责任；完成状态是本人标记。留白重叠会显示在账本中，时段不会自动移动。</p>
    {error && <p role="alert">{error}</p>}
    <div className="s02-editor-actions"><button type="submit" disabled={saving}>{saving ? "正在保存…" : pending ? "重试相同保存" : "保存"}</button><button type="button" onClick={onClose} disabled={saving || pending !== null}>关闭编辑</button></div>
  </form>;
}
