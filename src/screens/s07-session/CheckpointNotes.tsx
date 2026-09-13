import { useRef, useState } from "react";
import { SpeechInput } from "../../components/SpeechInput.tsx";
import { defaultUuid } from "../../domain/ids.ts";
import type { DomainStore } from "../../domain/store.ts";
import type { AppendCheckpointNoteCommand, Checkpoint } from "../../domain/types.ts";
import { checkpointNoteRecovery } from "./checkpoint-note-recovery.ts";

export function CheckpointNotes({ store, checkpoint }: { readonly store: DomainStore; readonly checkpoint: Checkpoint }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"text" | "voice">("text");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AppendCheckpointNoteCommand | null>(null);
  const [needsRebase, setNeedsRebase] = useState(false);
  const running = useRef(false);
  const save = async () => {
    if (running.current) return;
    const currentCheckpoint = store.getState().checkpoints[checkpoint.id];
    if (!currentCheckpoint) { setStatus("检查点已不存在，附注原文保留，无法保存。"); return; }
    const command = pending ?? {
      type: "appendCheckpointNote", commandId: defaultUuid(), actor: "user", issuedAt: new Date().toISOString(),
      entityId: checkpoint.id, expectedRevision: needsRebase ? currentCheckpoint.revision : checkpoint.revision, verbatim: text, channel,
    } satisfies AppendCheckpointNoteCommand;
    setPending(command);
    running.current = true;
    setBusy(true);
    try {
      const result = await store.execute(command);
      if (result.ok) {
        setPending(null);
        setNeedsRebase(false);
        setText("");
        setChannel("text");
        setStatus("附注已保存到本地共享状态。检查点原始快照与草稿均未改变。");
      } else {
        const recovery = checkpointNoteRecovery(result);
        if (recovery !== "retry") setPending(null);
        setNeedsRebase(recovery === "rebase");
        setStatus("附注保存未确认：" + result.reason + (recovery === "rebase" ? "。检查点版本已变化，原文保留。请核对最新记录，再明确按最新版本保存。" : recovery === "retry" ? "。重试将使用同一条命令。" : "。请核对后重新保存。"));
      }
    } catch (error) {
      setStatus("附注保存未确认：" + (error instanceof Error ? error.message : String(error)) + "。重试将使用同一条命令。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return <section className="s07-notes" aria-label="检查点附注">
    <h4>检查点附注</h4>
    <p className="s07-note">附注记录后来补充的原话，不补写历史快照、不确认未决定问题，也不修改草稿。</p>
    {checkpoint.notes?.length ? <ul className="s07-note-list">
      {checkpoint.notes.map(note => <li key={note.id}><p className="s07-note-verbatim">{note.verbatim}</p><small>{note.channel === "voice" ? "口述转写" : "文字输入"} · {new Date(note.createdAt).toLocaleString("zh-CN")}</small></li>)}
    </ul> : <p className="s07-note">尚无附注。</p>}
    <label>补充附注<textarea aria-label="补充附注" value={text} maxLength={20000} disabled={busy || pending !== null} onChange={event => setText(event.target.value)} /></label>
    <SpeechInput disabled={busy || pending !== null} onTranscript={value => { setText(current => current + (current ? "\n" : "") + value); setChannel("voice"); }} />
    <button type="button" className="s07-btn-ghost" disabled={busy || !text.trim()} onClick={save}>{busy ? "正在保存附注…" : pending ? "重试保存附注" : needsRebase ? "已核对，按最新版本保存附注" : "保存附注"}</button>
    {status && <p className="s07-note" role="status">{status}</p>}
  </section>;
}
