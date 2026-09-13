import { useState } from "react";
import { serializeBrowserWorkspaceRecovery } from "../../data/browserWorkspaceRecovery.ts";
import type { BrowserWorkspaceRecovery } from "../../data/browserWorkspaceRecovery.ts";

export function BrowserWorkspaceRecoveryNotice({ recovery }: { recovery: BrowserWorkspaceRecovery | null | undefined }) {
  const [error, setError] = useState("");
  if (!recovery) return null;
  const download = () => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([serializeBrowserWorkspaceRecovery(recovery)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "leubai-browser-workspace-backup.json";
      link.click();
      setError("");
    } catch {
      setError("备份下载未能启动，请重试。浏览器中的原始数据仍保留。");
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 1000);
    }
  };
  return <aside className="s06-boundary" data-browser-workspace-recovery>
    <h2>旧浏览器工作区备份</h2>
    {recovery.backups.length > 0 && <>
      <p>此账号在本浏览器中保留了 {recovery.backups.length} 份旧工作区数据，尚未导入当前账号工作区。旧数据可能包含演示内容，请先下载备份并核对，再在当前工作区重新录入需要保留的内容。</p>
      <p>下载保留原始内容，包括无法解析的记录；不会清空旧数据或覆盖服务端工作区。</p>
      <button type="button" className="s06-btn-ghost" onClick={download}>下载旧工作区备份</button>
    </>}
    {recovery.readErrors.map((reason) => <p key={reason}>{reason} 请恢复浏览器存储权限后刷新页面重试。</p>)}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
