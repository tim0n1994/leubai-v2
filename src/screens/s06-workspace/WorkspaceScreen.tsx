import { useState, useSyncExternalStore } from "react";
import { revealWorkspaceSection, workspaceSectionAnchor } from "./section-anchor.ts";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getBrowserLocalStorage, readPersistedState } from "../../data/index.ts";
import { useDomainState } from "../../data/react.ts";
import { defaultUuid } from "../../domain/ids.ts";
import type { DomainStore } from "../../domain/store.ts";
import type {
  DataMode,
  DomainCommand,
  DomainState,
  Draft,
  DraftSection,
  EntityId,
  Operation,
} from "../../domain/types.ts";
import { retryDomainRuntime, useDomainRuntime } from "../../runtime/index.ts";
import { DraftAssistant } from "../../settings/DraftAssistant";
import { workspaceCommands } from "./workspace-command.ts";
import { buildWorkspaceExport, downloadWorkspaceExport } from "./workspace-export.ts";
import "./s06-workspace.css";

const DRAFT_STATUS_WORDS: Partial<Record<Draft["status"], string>> = {
  generating: "生成中",
  pendingReview: "待检查",
  partiallyConfirmed: "部分确认",
  confirmed: "已确认",
  sent: "已发送",
  withdrawn: "已撤回",
};

function draftStatusWord(status: Draft["status"]): string {
  return DRAFT_STATUS_WORDS[status] ?? String(status);
}

function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(ms);
}

function formatStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(ms);
}

function issueCommand(): { commandId: string; actor: "user"; issuedAt: string } {
  return { commandId: defaultUuid(), actor: "user", issuedAt: new Date().toISOString() };
}

interface WorkspaceQueryIds {
  draftId: string | null;
  operationId: string | null;
  explicitEmptyId: boolean;
}

function readWorkspaceQueryIds(params: URLSearchParams): WorkspaceQueryIds {
  const read = (key: string): { present: boolean; value: string | null } => {
    const raw = params.get(key);
    if (raw === null) return { present: false, value: null };
    const value = raw.trim();
    return { present: true, value: value === "" ? null : value };
  };
  const draftId = read("draftId");
  const operationId = read("operationId");
  const explicitEmptyId =
    (draftId.present && draftId.value === null) || (operationId.present && operationId.value === null);
  return { draftId: draftId.value, operationId: operationId.value, explicitEmptyId };
}

function isWithdrawnDraft(draft: Draft): boolean {
  return String(draft.status) === "withdrawn";
}

function ownsDraftViaStepReceipts(operation: Operation, draftId: EntityId): boolean {
  return operation.stepReceipts.some(
    (receipt) =>
      receipt.actionKind === "createDraft" && receipt.status === "completed" && receipt.resultRef === draftId,
  );
}

function operationOwnsDraft(operation: Operation, draftId: EntityId): boolean {
  if (operation.resultRefs.includes(draftId)) return true;
  return operation.resultRefs.length === 0 && ownsDraftViaStepReceipts(operation, draftId);
}

export function WorkspaceScreen() {
  const [searchParams] = useSearchParams();
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const query = readWorkspaceQueryIds(searchParams);

  return (
    <div className="s06" data-page="s06">
      <header className="s06-head">
        <h1>让 AI 准备，让判断回到你。</h1>
        <p>草稿不是完成，确认不是发送；每一步有自己的状态。</p>
      </header>
      <WorkspaceRuntime
        key={runtimeEpoch}
        dataMode="fixture"
        query={query}
        onRetrySettled={() => setRuntimeEpoch((epoch) => epoch + 1)}
      />
    </div>
  );
}

interface WorkspaceRuntimeProps {
  dataMode: DataMode;
  query: WorkspaceQueryIds;
  onRetrySettled: () => void;
}

function WorkspaceRuntime({ dataMode, query, onRetrySettled }: WorkspaceRuntimeProps) {
  const runtime = useDomainRuntime(dataMode);
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    retryDomainRuntime(dataMode)
      .catch(() => {
        setRetrying(false);
      })
      .finally(() => {
        setRetrying(false);
        onRetrySettled();
      });
  };

  if (runtime.status === "loading") {
    return (
      <div className="s06-boundary" data-runtime-state="loading">
        <h2>正在连接本地领域数据…</h2>
      </div>
    );
  }
  if (runtime.status === "unavailable") {
    return (
      <div className="s06-boundary s06-boundary-error" data-runtime-state="unavailable">
        <h2>本地领域数据当前不可读</h2>
        <p data-runtime-reason>
          {runtime.handle && runtime.handle.status !== "ready"
            ? runtime.handle.status + "：" + runtime.reason
            : "初始化失败：" + runtime.reason}
        </p>
        <p>原始数据已保留，未被清除；存储恢复之前不会显示或确认任何草稿。</p>
        <div className="s06-recovery">
          <button
            type="button"
            className="s06-btn-ghost s06-btn-wide"
            data-runtime-retry
            onClick={retry}
            disabled={retrying}
          >
            {retrying ? "正在重试连接…" : "重试连接本地数据"}
            <span aria-hidden="true">↻</span>
          </button>
          <p className="s06-note">重试只重建读取通道，不会清空或改写已保存的数据。</p>
        </div>
      </div>
    );
  }
  return (
    <div data-runtime-state="ready">
      <WorkspaceCommandNotice store={runtime.runtime.store} />
      <WorkspaceReady
        store={runtime.runtime.store}
        dataMode={runtime.runtime.dataMode}
        query={query}
      />
    </div>
  );
}

function WorkspaceCommandNotice({ store }: { store: DomainStore }) {
  const controller = workspaceCommands(store);
  const commandState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [retryError, setRetryError] = useState("");
  const pending = commandState.pending;
  if (!pending) return null;
  return <section className="s06-boundary s06-boundary-error" role="alert" data-workspace-uncertain>
    <h2>结果未确认；不会当作已保存</h2>
    <p>原操作可能已经写入，其他草稿修改暂不可用。请恢复存储读取后重试原操作，不要刷新或另建命令覆盖它。</p>
    <button type="button" className="s06-btn-ghost" data-workspace-exact-retry disabled={commandState.busy} onClick={() => {
      void controller.retry().then(result => setRetryError(result && !result.ok ? result.text : ""));
    }}>{commandState.busy ? "正在确认原操作…" : "重试原操作（同一命令）"}</button>
    {retryError && <p>{retryError}</p>}
    <details><summary>查看保留的原操作</summary><p>{pending.command.commandId}</p>{pending.command.type === "editDraftSection" && <pre className="s06-body">{pending.command.content}</pre>}</details>
  </section>;
}

interface WorkspaceReadyProps {
  store: DomainStore;
  dataMode: DataMode;
  query: WorkspaceQueryIds;
}

function WorkspaceReady({ store, dataMode, query }: WorkspaceReadyProps) {
  const state = useDomainState(store);
  const { draftId, operationId, explicitEmptyId } = query;

  if (!draftId && !operationId && !explicitEmptyId) {
    const eligible = Object.values(state.drafts)
      .filter((candidate) => !isWithdrawnDraft(candidate))
      .filter((candidate) => {
        const operation = state.operations[candidate.operationId];
        return Boolean(operation && operationOwnsDraft(operation, candidate.id));
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const selected = eligible[0];
    if (!selected) {
      return (
        <div className="s06-boundary" data-draft-missing="no-draft">
          <h2>现在没有待检查的草稿</h2>
          <p>工作台只显示由真实执行操作生成、并且仍属于你的草稿。</p>
          <p>草稿生成后可以从协同入口打开；现在也可以先回到计划。</p>
          <Link className="s06-return-link" data-return-plan to="/plan">
            返回计划
          </Link>
        </div>
      );
    }
    return <WorkspaceDraft store={store} dataMode={dataMode} draft={selected} domain={state} />;
  }

  if (!draftId || !operationId || explicitEmptyId) {
    return (
      <div className="s06-boundary" data-draft-missing="incomplete-ids">
        <h2>无法确认草稿归属</h2>
        <p>链接不完整，请从草稿入口重新打开。</p>
        <Link className="s06-return-link" data-return-plan to="/plan">
          返回计划
        </Link>
      </div>
    );
  }

  const draft = state.drafts[draftId];
  if (!draft) {
    return (
      <div className="s06-boundary" data-draft-missing="not-found">
        <h2>找不到这份草稿</h2>
        <p>链接指定的草稿不存在，或还没有生成完成。</p>
        <p>不会用示例内容顶替你的草稿。</p>
        <Link className="s06-return-link" data-return-plan to="/plan">
          返回计划
        </Link>
      </div>
    );
  }

  const operation = state.operations[operationId];
  if (!operation || draft.operationId !== operation.id || !operationOwnsDraft(operation, draft.id)) {
    return (
      <div className="s06-boundary" data-draft-missing="operation-mismatch">
        <h2>草稿与链接中的执行操作不对应</h2>
        <p>无法证明这份草稿由该操作生成；为避免把别人的草稿当成你的，这里拒绝显示。</p>
        <p>请回到发起草稿的入口，用完整链接重新打开。</p>
        <Link className="s06-return-link" data-return-plan to="/plan">
          返回计划
        </Link>
      </div>
    );
  }

  if (isWithdrawnDraft(draft)) {
    return <WorkspaceWithdrawn draft={draft} />;
  }
  return <WorkspaceDraft store={store} dataMode={dataMode} draft={draft} domain={state} />;
}

interface WorkspaceWithdrawnProps {
  draft: Draft;
}

function WorkspaceWithdrawn({ draft }: WorkspaceWithdrawnProps) {
  return (
    <div className="s06-layout">
      <article className="s06-doc" aria-label="已撤回的工作草稿">
        <div className="s06-doc-top">
          <span className="s06-status" data-draft-status="withdrawn">
            草稿 · 已撤回
          </span>
          <span className="s06-doc-meta">
            <span className="s06-sent" data-sent-state={draft.sentAt ? "sent" : "not-sent"}>
              {draft.sentAt ? "已发送" : "未发送 · 撤回也不是发送"}
            </span>
            <span className="s06-saved">最后更新于 {formatClock(draft.updatedAt)}</span>
          </span>
        </div>
        <h2 className="s06-doc-title">这份草稿已被撤回</h2>
        <p className="s06-goal">
          撤回后不能再编辑、确认、登记材料或保存检查点；下面只是撤回时的原样记录，不是可继续操作的草稿。
        </p>
        {draft.withdrawal && (
          <p className="s06-note" data-withdrawn-meta>
            撤回于 {formatStamp(draft.withdrawal.withdrawnAt)}
            {draft.withdrawal.reason ? " · 原因：" + draft.withdrawal.reason : " · 未记录原因"}
          </p>
        )}
        {draft.sections.map((section, index) => (
          <section
            key={section.id}
            id={workspaceSectionAnchor(section.id)}
            ref={revealWorkspaceSection}
            tabIndex={-1}
            className="s06-section"
            data-section-id={section.id}
            data-section-review-status={section.reviewStatus}
            aria-label={section.title}
          >
            <h3>
              <span className="s06-num">{String(index + 1).padStart(2, "0")}</span>
              {section.title}
              <span className="s06-section-state">
                {section.reviewStatus === "confirmed" ? "已确认" : "未核实"}
              </span>
            </h3>
            <p className="s06-body">{section.content}</p>
            {section.openIssues.length > 0 && (
              <ul className="s06-issues" data-section-issues>
                {section.openIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <Link className="s06-return-link" data-return-plan to="/plan">
          返回计划
        </Link>
      </article>
    </div>
  );
}

interface WorkspaceDraftProps {
  store: DomainStore;
  dataMode: DataMode;
  draft: Draft;
  domain: DomainState;
}

interface SectionEditSession {
  text: string;
  capturedRevision: number;
  capturedContentVersion: number;
}

type MaterialPermissionChoice = "granted" | "denied";

interface AssistantSnapshot {
  sectionId: EntityId;
  sectionTitle: string;
  capturedRevision: number;
  capturedContentVersion: number;
  input: string;
}

function WorkspaceDraft({ store, dataMode, draft, domain }: WorkspaceDraftProps) {
  const navigate = useNavigate();
  const controller = workspaceCommands(store);
  const commandState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; text: string; code?: string | null; command?: DomainCommand } | null>(null);
  const [flagDrafts, setFlagDrafts] = useState<Record<string, string>>({});
  const [flagEditors, setFlagEditors] = useState<Record<string, boolean>>({});
  const [sectionEdits, setSectionEdits] = useState<Record<string, SectionEditSession>>({});
  const [editingSections, setEditingSections] = useState<Record<string, boolean>>({});
  const [assistantSectionId, setAssistantSectionId] = useState<EntityId | null>(null);
  const [materialName, setMaterialName] = useState("");
  const [materialExpanded, setMaterialExpanded] = useState(false);
  const [materialAccessRef, setMaterialAccessRef] = useState("");
  const [materialVersion, setMaterialVersion] = useState("1");
  const [materialContent, setMaterialContent] = useState("");
  const [materialPermission, setMaterialPermission] = useState<MaterialPermissionChoice | null>(null);
  const [materialSectionIds, setMaterialSectionIds] = useState<EntityId[]>([]);
  const [nextStep, setNextStep] = useState("");
  const [withdrawStage, setWithdrawStage] = useState<{ draftId: EntityId; revision: number } | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const commitment = domain.commitments[draft.commitmentId];
  const latestCheckpoint =
    Object.values(domain.checkpoints)
      .filter((c) => c.draftId === draft.id)
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
  const draftMaterials = Object.values(domain.materials).filter((m) => m.draftId === draft.id);
  const unverifiedDraftMaterials = draftMaterials.filter((m) => !m.verified);
  const globalMaterialRead = domain.ruleset.grants.readMaterial;
  const interactionsLocked = draft.sentAt !== null || commandState.pending !== null || commandState.busy;
  const materialLocked = busy !== null || interactionsLocked;
  const materialVersionValue = Number(materialVersion);
  const materialFormComplete =
    materialName.trim().length > 0 &&
    materialVersion.trim() !== "" &&
    Number.isInteger(materialVersionValue) &&
    materialVersionValue > 0 &&
    (materialContent.trim().length > 0 || materialAccessRef.trim().length > 0) &&
    materialPermission !== null &&
    materialSectionIds.length > 0;

  const assistantSection =
    assistantSectionId === null
      ? null
      : (draft.sections.find((section) => section.id === assistantSectionId) ?? null);
  const assistantSession = assistantSection ? (sectionEdits[assistantSection.id] ?? null) : null;
  const assistantSnapshot: AssistantSnapshot | null =
    assistantSection === null || draft.sentAt !== null
      ? null
      : {
          sectionId: assistantSection.id,
          sectionTitle: assistantSection.title,
          capturedRevision: assistantSession ? assistantSession.capturedRevision : draft.revision,
          capturedContentVersion: assistantSession
            ? assistantSession.capturedContentVersion
            : assistantSection.contentVersion,
          input: assistantSession ? assistantSession.text : assistantSection.content,
        };

  const run = async (
    key: string,
    command: DomainCommand,
  ): Promise<{ ok: boolean; code: string | null }> => {
    const pending = controller.getSnapshot().pending;
    if (controller.getSnapshot().busy || (pending && (pending.key !== key || pending.command.entityId !== command.entityId))) return { ok: false, code: "WORKSPACE_UNRESOLVED" };
    setBusy(key);
    setFailure(null);
    const result = await controller.run(key, command, () => {
      setFailure(null);
      if (command.type === "editDraftSection") {
        setSectionEdits(previous => { const next = { ...previous }; delete next[command.sectionId]; return next; });
        setEditingSections(previous => ({ ...previous, [command.sectionId]: false }));
        setAssistantSectionId(previous => previous === command.sectionId ? null : previous);
      }
      if (command.type === "flagSectionIssue") setFlagDrafts(previous => ({ ...previous, [command.sectionId]: "" }));
      if (command.type === "registerMaterial") {
        setMaterialName(""); setMaterialContent(""); setMaterialAccessRef(""); setMaterialVersion("1"); setMaterialPermission(null); setMaterialSectionIds([]);
      }
      if (command.type === "saveCheckpoint") setNextStep("");
      if (command.type === "withdrawDraft") { setWithdrawStage(null); setWithdrawReason(""); }
    });
    setBusy(null);
    if (!result.ok) {
      setFailure({
        key,
        text: result.text,
        code: result.code,
        command: result.command,
      });
      return { ok: false, code: result.code };
    }
    return { ok: true, code: null };
  };

  const confirmSection = (section: DraftSection) =>
    run("confirm:" + section.id, {
      type: "confirmSections",
      ...issueCommand(),
      entityId: draft.id,
      expectedRevision: draft.revision,
      sections: [{ sectionId: section.id, expectedContentVersion: section.contentVersion }],
    });

  const changeSectionEdit = (section: DraftSection, text: string) => {
    if (interactionsLocked) return;
    setSectionEdits((prev) => {
      const existing = prev[section.id];
      if (existing) return { ...prev, [section.id]: { ...existing, text } };
      return {
        ...prev,
        [section.id]: {
          text,
          capturedRevision: draft.revision,
          capturedContentVersion: section.contentVersion,
        },
      };
    });
  };

  const saveSectionEdit = async (section: DraftSection) => {
    const session = sectionEdits[section.id];
    if (!session) return;
    const result = await run("edit:" + section.id, {
      type: "editDraftSection",
      ...issueCommand(),
      entityId: draft.id,
      expectedRevision: session.capturedRevision,
      sectionId: section.id,
      expectedContentVersion: session.capturedContentVersion,
      content: session.text,
    });
    if (result.ok) {
      setSectionEdits((prev) => {
        const next = { ...prev };
        delete next[section.id];
        return next;
      });
      setEditingSections((prev) => ({ ...prev, [section.id]: false }));
      return;
    }
  };

  const applyAssistantDraft = async (snapshot: AssistantSnapshot, proposalText: string) => {
    const key = "assistant-apply:" + snapshot.sectionId;
    const result = await run(key, {
        type: "editDraftSection",
        ...issueCommand(),
        entityId: draft.id,
        expectedRevision: snapshot.capturedRevision,
        sectionId: snapshot.sectionId,
        expectedContentVersion: snapshot.capturedContentVersion,
        content: proposalText,
      });
    if (!result.ok) {
      throw new Error("应用未确认；原操作已保留，请查看工作台的恢复提示。");
    }
    setSectionEdits((prev) => {
      if (!(snapshot.sectionId in prev)) return prev;
      const next = { ...prev };
      delete next[snapshot.sectionId];
      return next;
    });
    setAssistantSectionId((prev) => (prev === snapshot.sectionId ? null : prev));
  };

  const flagIssue = async (section: DraftSection) => {
    const issue = (flagDrafts[section.id] ?? "").trim();
    if (!issue) {
      setFailure({ key: "flag:" + section.id, text: "请先写下你的判断或问题，再标记。" });
      return;
    }
    const result = await run("flag:" + section.id, {
      type: "flagSectionIssue",
      ...issueCommand(),
      entityId: draft.id,
      expectedRevision: draft.revision,
      sectionId: section.id,
      issue,
    });
    if (result.ok) setFlagDrafts((prev) => ({ ...prev, [section.id]: "" }));
  };

const registerMaterial = async () => {
  const name = materialName.trim();
  const content = materialContent;
  const contentTrimmed = content.trim();
  const accessRef = materialAccessRef.trim();
    const version = Number(materialVersion);
    if (!name) {
      setFailure({ key: "material", text: "材料需要名称；请先填写材料名称。" });
      return;
    }
    if (materialVersion.trim() === "" || !Number.isInteger(version) || version <= 0) {
      setFailure({ key: "material", text: "材料版本需要是正整数；请检查版本号。" });
      return;
    }
  if (!contentTrimmed && !accessRef) {
      setFailure({
        key: "material",
        text: "材料需要本地文本或你手动提供的引用，至少填写一项；这里不会自动抓取或生成引用。",
      });
      return;
    }
    if (materialPermission === null) {
      setFailure({
        key: "material",
        text: "请先明确选择读取授权（授权读取或不授权读取）；这里不会默认授权。",
      });
      return;
    }
    if (materialSectionIds.length === 0) {
      setFailure({
        key: "material",
        text: "请至少勾选一个当前草稿的小节；材料必须关联到具体小节。",
      });
      return;
    }
    const result = await run("material", {
      type: "registerMaterial",
      ...issueCommand(),
      entityId: draft.id,
      expectedRevision: draft.revision,
      name,
      version,
      readPermission: materialPermission,
      sectionIds: materialSectionIds,
    ...(contentTrimmed !== "" ? { content } : {}),
      ...(accessRef !== "" ? { accessRef } : {}),
    });
    if (result.ok) {
      setMaterialName("");
      setMaterialContent("");
      setMaterialAccessRef("");
      setMaterialVersion("1");
      setMaterialPermission(null);
      setMaterialSectionIds([]);
    }
  };

  const toggleMaterialSection = (sectionId: EntityId) => {
    setMaterialSectionIds((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId],
    );
  };

  const materialSectionTitle = (sectionId: EntityId): string =>
    draft.sections.find((section) => section.id === sectionId)?.title ??
    sectionId + "（当前草稿中不存在）";

  const saveCheckpoint = async () => {
    const result = await run("checkpoint", {
      type: "saveCheckpoint",
      ...issueCommand(),
      entityId: draft.id,
      expectedRevision: draft.revision,
      draftId: draft.id,
      nextStep: nextStep.trim() || null,
    });
    if (result.ok) setNextStep("");
  };

  const withdrawUnavailable =
    busy !== null || interactionsLocked || draft.status === "sent" || draft.status === "withdrawn";

  const openWithdrawConfirmation = () => {
    if (withdrawUnavailable || withdrawStage !== null) return;
    setFailure(null);
    setWithdrawReason("");
    setWithdrawStage({ draftId: draft.id, revision: draft.revision });
    navigate(
      "/workspace?draftId=" +
        encodeURIComponent(draft.id) +
        "&operationId=" +
        encodeURIComponent(draft.operationId),
    );
  };

  const cancelWithdraw = () => {
    if (busy === "withdraw" || interactionsLocked) return;
    setFailure(null);
    setWithdrawStage(null);
    setWithdrawReason("");
  };

  const confirmWithdraw = async () => {
    if (withdrawStage === null || busy !== null) return;
    const reason = withdrawReason.trim();
    const result = await run("withdraw", {
      type: "withdrawDraft",
      ...issueCommand(),
      entityId: withdrawStage.draftId,
      expectedRevision: withdrawStage.revision,
      actor: "user",
      ...(reason !== "" ? { reason } : {}),
    });
    if (result.ok) {
      setWithdrawStage(null);
      setWithdrawReason("");
    }
  };

  const refreshReadback = () => {
    if (controller.getSnapshot().pending || controller.getSnapshot().busy) return;
    const storage = getBrowserLocalStorage();
    if (!storage) return;
    const fresh = readPersistedState(storage, dataMode);
    if (fresh.kind === "ok") store.adoptExternalState(fresh.envelope.state);
  };

  const exportDraft = () => {
    if (busy !== null || controller.getSnapshot().busy || controller.getSnapshot().pending !== null) return;
    setExportNotice(null);
    try {
      const storage = getBrowserLocalStorage();
      const fresh = storage ? readPersistedState(storage, dataMode) : null;
      if (!fresh || fresh.kind !== "ok") {
        setExportNotice({ ok: false, text: "无法确认已保存数据，未生成文件；请恢复本地存储读取后重试。" });
        return;
      }
      const result = buildWorkspaceExport(fresh.envelope.state, draft.id, draft.revision, new Date().toISOString());
      if (!result.ok) { setExportNotice({ ok: false, text: result.reason }); return; }
      downloadWorkspaceExport(result.file);
      setExportNotice({ ok: true, text: "已生成 " + result.file.filename + " 并请求浏览器下载；请在下载列表检查文件。未发送或提交任何内容。" });
    } catch (error) {
      setExportNotice({ ok: false, text: "导出未确认，请检查浏览器下载设置后重试：" + (error instanceof Error ? error.message : String(error)) });
    }
  };

  const rebaseSectionEdit = (section: DraftSection) => {
    if (interactionsLocked || busy !== null) return;
    const storage = getBrowserLocalStorage();
    if (!storage) return;
    const fresh = readPersistedState(storage, dataMode);
    if (fresh.kind !== "ok") return;
    const current = fresh.envelope.state.drafts[draft.id];
    const currentSection = current?.sections.find(item => item.id === section.id);
    if (!current || !currentSection || current.sentAt !== null || current.status === "withdrawn") return;
    store.adoptExternalState(fresh.envelope.state);
    const attempted = failure?.command;
    setSectionEdits(previous => ({ ...previous, [section.id]: {
      text: failure?.key.startsWith("assistant-apply:") && attempted?.type === "editDraftSection" ? attempted.content : previous[section.id]?.text ?? section.content,
      capturedRevision: current.revision,
      capturedContentVersion: currentSection.contentVersion,
    } }));
    setEditingSections(previous => ({ ...previous, [section.id]: true }));
    setFailure(null);
  };

  return (
    <div className="s06-layout">
      <article className="s06-doc" aria-label="工作草稿">
        <div className="s06-doc-top">
          <span className="s06-status" data-draft-status={draft.status}>
            草稿 · {commandState.pending ? "保存结果未确认" : draftStatusWord(draft.status)}
          </span>
          <span className="s06-doc-meta">
            <span className="s06-sent" data-sent-state={draft.sentAt ? "sent" : "not-sent"}>
              {draft.sentAt ? "已发送" : "未发送 · 确认也不会自动发送"}
            </span>
            <span className="s06-saved">{commandState.pending ? "显示上次确认的数据；当前候选仍待读回" : "自动保存于 " + formatClock(draft.updatedAt)}</span>
          </span>
        </div>
        <h2 className="s06-doc-title">{(commitment?.scope ?? "协同工作") + " · 工作草稿"}</h2>
        {commitment?.scope && <p className="s06-goal">承诺：{commitment.scope}</p>}
        {draft.sources.length > 0 && (
          <ul className="s06-sources">
            {draft.sources.map((sid) => (
              <li key={sid}>{domain.sources[sid]?.connectorId ?? sid}</li>
            ))}
          </ul>
        )}
        {draft.sections.map((section, index) => (
          <section
            key={section.id}
            id={workspaceSectionAnchor(section.id)}
            ref={revealWorkspaceSection}
            tabIndex={-1}
            className="s06-section"
            data-section-id={section.id}
            data-section-review-status={section.reviewStatus}
            aria-label={section.title}
          >
            <h3>
              <span className="s06-num">{String(index + 1).padStart(2, "0")}</span>
              {section.title}
              <span className="s06-section-state">
                {section.reviewStatus === "confirmed" ? "已确认" : "未核实"}
              </span>
            </h3>
            {!editingSections[section.id] && <p className="s06-body">{section.content}</p>}
            {section.openIssues.length > 0 && (
              <ul className="s06-issues" data-section-issues>
                {section.openIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {section.confirmationInvalidReason && (
              <p className="s06-warn" data-section-invalid-reason>
                确认已失效：{section.confirmationInvalidReason}
              </p>
            )}
            {!editingSections[section.id] ? <div className="s06-editor-actions">
              <button type="button" className="s06-btn-ghost" data-section-edit-open={section.id} aria-expanded={false} onClick={() => setEditingSections(prev => ({ ...prev, [section.id]: true }))} disabled={busy !== null || interactionsLocked}>编辑本节</button>
              {sectionEdits[section.id] && <p className="s06-note" role="status">未保存的文字仍保留，再次编辑可继续。</p>}
            </div> : <div className="s06-editor">
              <textarea
                className="s06-editor-input"
                data-section-editor={section.id}
                value={sectionEdits[section.id]?.text ?? section.content}
                onChange={(e) => changeSectionEdit(section, e.target.value)}
                disabled={busy !== null || interactionsLocked}
                aria-label={"编辑正文：" + section.title}
                placeholder="直接修改这一节正文；保存之前不会影响草稿。"
              />
              <div className="s06-editor-actions">
                <span className="s06-note">
                  {sectionEdits[section.id]
                    ? "有未保存的修改；保存使用你开始编辑时的版本，冲突时会保留这段文字。"
                    : "想修改正文时直接在这里改；保存后这一节的确认需要重新做。"}
                </span>
                <div className="s06-editor-buttons">
                  <button
                    type="button"
                    className="s06-btn-ghost"
                    data-assistant-open={section.id}
                    onClick={() => setAssistantSectionId(section.id)}
                    disabled={busy !== null || interactionsLocked || assistantSectionId === section.id}
                  >
                    用草稿助手处理这一节
                  </button>
                  <button
                    type="button"
                    className="s06-btn-ghost"
                    data-section-save={section.id}
                    onClick={() => saveSectionEdit(section)}
                    disabled={busy !== null || commandState.busy || draft.sentAt !== null || (commandState.pending !== null && commandState.pending.key !== "edit:" + section.id) || !sectionEdits[section.id] || (failure?.key === "edit:" + section.id && failure.code === "REVISION_CONFLICT" && commandState.pending === null)}
                  >
                    {failure?.key === "edit:" + section.id ? "重试保存这一节" : "保存这一节"}
                    <span aria-hidden="true">↧</span>
                  </button>
                  <button type="button" className="s06-btn-ghost" data-section-edit-cancel={section.id} disabled={busy !== null || interactionsLocked} onClick={() => {
                    setEditingSections(prev => ({ ...prev, [section.id]: false }));
                    if (assistantSectionId === section.id) setAssistantSectionId(null);
                  }}>取消编辑（保留未保存文字）</button>
                </div>
              </div>
              {failure?.key === "edit:" + section.id && (
                <div className="s06-error" data-command-error="edit">
                  {failure.text}
                  {failure.code === "REVISION_CONFLICT" && commandState.pending === null && <button type="button" className="s06-btn-ghost" data-section-rebase={section.id} onClick={() => rebaseSectionEdit(section)}>重新读取版本并保留我的文字</button>}
                </div>
              )}
            </div>}
          </section>
        ))}
        {draft.openQuestions.length > 0 && (
          <section className="s06-section" aria-label="仍然不能下结论的地方">
            <h3>
              <span className="s06-num">？</span>仍然不能下结论的地方
            </h3>
            <ul className="s06-body">
              {draft.openQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </section>
        )}
      </article>
      <aside className="s06-rail" aria-label="接下来的判断">
        <h3 className="s06-rail-kicker">
          <span className="s06-num">01</span>接下来，逐节完成你的判断
        </h3>
        {draft.sections.map((section) => (
          <section key={section.id} className="s06-block" aria-label={section.title + "判断"}>
            <h4>{section.title}</h4>
            <p>
              {section.reviewStatus === "confirmed"
                ? "这一节已确认；仍有疑问可以标记，标记会让确认失效。"
                : "确认表示你已亲自检查这一节；也可以先记录疑问。"}
            </p>
            <div className="s06-judgment-actions">
              <button
                type="button"
                className="s06-btn-ghost"
                data-confirm-section={section.id}
                onClick={() => confirmSection(section)}
                disabled={busy !== null || interactionsLocked || section.reviewStatus === "confirmed"}
              >
                确认这一节
              </button>
              <button
                type="button"
                className="s06-btn-ghost"
                data-flag-open={section.id}
                aria-expanded={Boolean(flagEditors[section.id])}
                aria-controls={"s06-flag-editor-" + section.id}
                disabled={busy !== null || interactionsLocked}
                onClick={() => setFlagEditors(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
              >
                {flagEditors[section.id] ? "收起疑问（保留输入）" : "记录疑问"}
              </button>
            </div>
            <div id={"s06-flag-editor-" + section.id} className="s06-disclosure" hidden={!flagEditors[section.id]}>
            <label className="s06-note">{section.title} · 判断或疑问<input
              className="s06-input"
              data-flag-input={section.id}
              value={flagDrafts[section.id] ?? ""}
              disabled={busy !== null || interactionsLocked}
              onChange={(e) => setFlagDrafts((prev) => ({ ...prev, [section.id]: e.target.value }))}
              placeholder="记录你的判断或疑问…"
            /></label>
            <button
              type="button"
              className="s06-btn-ghost s06-btn-wide"
              data-flag-section={section.id}
              onClick={() => flagIssue(section)}
              disabled={busy !== null || interactionsLocked}
            >
              标记问题
              <span aria-hidden="true">!</span>
            </button>
            </div>
            {failure?.key === "confirm:" + section.id && (
              <p className="s06-error" data-command-error="confirm">
                {failure.text}
              </p>
            )}
            {failure?.key === "flag:" + section.id && (
              <p className="s06-error" data-command-error="flag">
                {failure.text}
              </p>
            )}
          </section>
        ))}
        {assistantSnapshot && (
          <section
            className="s06-block s06-assistant-block"
            data-assistant-panel={assistantSnapshot.sectionId}
            aria-label={"草稿助手：" + assistantSnapshot.sectionTitle}
          >
            <div className="s06-assistant-head">
              <h4 data-assistant-section-title={assistantSnapshot.sectionTitle}>
                草稿助手 · {assistantSnapshot.sectionTitle}
              </h4>
              <button
                type="button"
                className="s06-btn-ghost"
                data-assistant-close
                onClick={() => setAssistantSectionId(null)}
                disabled={busy !== null || interactionsLocked}
              >
                关闭助手
              </button>
            </div>
            <p className="s06-note">只处理这一节的正文；生成需要手动点击，应用之前不会改动草稿。</p>
            <fieldset className="s06-assistant-controls" disabled={busy !== null || interactionsLocked}><DraftAssistant
              key={JSON.stringify([
                draft.id,
                assistantSnapshot.sectionId,
                draft.revision,
                assistantSection?.contentVersion,
                assistantSnapshot.capturedRevision,
                assistantSnapshot.capturedContentVersion,
                assistantSnapshot.input,
              ])}
              input={assistantSnapshot.input}
              onApply={(text) => applyAssistantDraft(assistantSnapshot, text)}
            /></fieldset>
            {failure?.key === "assistant-apply:" + assistantSnapshot.sectionId && (
              <div className="s06-error" data-command-error="assistant-apply">
                {failure.text}
                {failure.code === "REVISION_CONFLICT" && commandState.pending === null && assistantSection !== null && <button type="button" className="s06-btn-ghost" onClick={() => rebaseSectionEdit(assistantSection)}>重新读取版本并保留建议正文</button>}
              </div>
            )}
          </section>
        )}
        <div className="s06-divider" role="presentation" />
        <section className="s06-block" aria-label="成本材料">
          <h4>
            {draftMaterials.length === 0 || unverifiedDraftMaterials.length > 0
              ? "成本核对还没有完成"
              : "成本材料核对状态"}
          </h4>
          <p>
            {draftMaterials.length === 0
              ? "还没有与这份草稿关联的材料。可以在这里登记材料，或把它保留为待核对事项。"
              : unverifiedDraftMaterials.length > 0
                ? "已登记材料仍未核实，不会作为结论依据。"
                : "这份草稿关联的材料都已核实。"}
          </p>
          <button
            type="button"
            className="s06-btn-ghost s06-btn-wide"
            data-material-open
            aria-expanded={materialExpanded}
            aria-controls="s06-material-editor"
            disabled={materialLocked}
            onClick={() => setMaterialExpanded(expanded => !expanded)}
          >
            {materialExpanded ? "收起材料（保留输入）" : draftMaterials.length > 0 ? "查看或补充材料" : "补充材料"}
            <span aria-hidden="true">{materialExpanded ? "−" : "＋"}</span>
          </button>
          <div id="s06-material-editor" className="s06-disclosure" hidden={!materialExpanded}>
          {!globalMaterialRead && (
            <p className="s06-warn" data-material-global-read="off">
              全局材料读取已关闭：单条材料的“授权读取”不能覆盖这个设置；此刻材料内容不会被读取或应用，选择“不授权读取”仍会作为记录保存。
            </p>
          )}
          <p className="s06-note" data-materials-scope="draft-associated">
            这里只列出与当前草稿关联的材料；没有草稿关联的旧材料不会出现在下面，也不会被带入这份草稿。
          </p>
          {draftMaterials.map((m) => {
            const linkedTitles = (m.sectionIds ?? []).map(materialSectionTitle);
            const permission = m.readPermission ?? null;
            return (
              <div
                key={m.id}
                className="s06-attached"
                data-material-item={m.id}
                data-material-permission={permission ?? "unrecorded"}
              >
                <p className="s06-attached-title">
                  {m.name} · v{m.version}
                </p>
                <p className="s06-note" data-material-sections>
                  {linkedTitles.length > 0
                    ? permission === "denied"
                      ? "记录关联小节（未应用）：" + linkedTitles.join("、")
                      : "关联小节：" + linkedTitles.join("、")
                    : "未记录关联小节"}
                </p>
                <p className="s06-note" data-material-permission-text>
                  {permission === "granted"
                    ? globalMaterialRead
                      ? "已明确授权读取。"
                      : "已记录单条授权读取；当前全局材料读取已关闭，内容不会被读取或应用。"
                    : permission === "denied"
                      ? "未授权读取：只是存档，内容不会被读取、应用或作为输入。"
                      : "授权状态未记录（旧数据）；不能当作已授权材料使用。"}
                </p>
                <p className="s06-note" data-material-verified={String(m.verified)}>
                  {m.verified ? "已核实。" : "未核实：材料已登记但未经过人工核对，不作为结论依据。"}
                </p>
              </div>
            );
          })}
          <label className="s06-note">材料名称<input
            className="s06-input"
            data-material-name
            value={materialName}
            onChange={(e) => setMaterialName(e.target.value)}
            placeholder="材料名称…"
            disabled={materialLocked}
          /></label>
          <textarea
            className="s06-input s06-material-content"
            data-material-content
            value={materialContent}
            onChange={(e) => setMaterialContent(e.target.value)}
            rows={4}
            placeholder="直接粘贴材料文本（可选；只保存在本地数据里）"
            disabled={materialLocked}
            aria-label="材料本地文本"
          />
          <input
            className="s06-input"
            data-material-access-ref
            value={materialAccessRef}
            onChange={(e) => setMaterialAccessRef(e.target.value)}
            placeholder="材料引用（可选；由你手动填写，不会自动抓取）…"
            disabled={materialLocked}
            aria-label="材料引用"
          />
          <div className="s06-material-row">
            <label className="s06-note" htmlFor="s06-material-version">
              版本（正整数）
            </label>
            <input
              id="s06-material-version"
              className="s06-input s06-material-version"
              data-material-version
              type="number"
              min={1}
              step={1}
              value={materialVersion}
              onChange={(e) => setMaterialVersion(e.target.value)}
              disabled={materialLocked}
            />
          </div>
          <fieldset className="s06-material-fieldset" data-material-permission-choice>
            <legend className="s06-note">读取授权（必选；默认未设置，不会自动授权）</legend>
            <label className="s06-material-choice">
              <input
                type="radio"
                name="s06-material-read-permission"
                data-material-read-permission="granted"
                checked={materialPermission === "granted"}
                onChange={() => setMaterialPermission("granted")}
                disabled={materialLocked}
              />
              <span>授权读取：材料会应用到下面勾选的小节</span>
            </label>
            <label className="s06-material-choice">
              <input
                type="radio"
                name="s06-material-read-permission"
                data-material-read-permission="denied"
                checked={materialPermission === "denied"}
                onChange={() => setMaterialPermission("denied")}
                disabled={materialLocked}
              />
              <span>不授权读取：只存档，不应用到任何小节</span>
            </label>
          </fieldset>
          {draft.sections.length > 0 ? (
            <fieldset className="s06-material-fieldset" data-material-section-choice>
              <legend className="s06-note">关联小节（必选；只列当前草稿的小节）</legend>
              {draft.sections.map((section) => (
                <label key={section.id} className="s06-material-choice">
                  <input
                    type="checkbox"
                    data-material-section={section.id}
                    checked={materialSectionIds.includes(section.id)}
                    onChange={() => toggleMaterialSection(section.id)}
                    disabled={materialLocked}
                  />
                  <span>{section.title}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="s06-note">当前草稿没有小节，没有可关联的小节；这种状态下无法登记材料。</p>
          )}
          <button
            type="button"
            className="s06-btn-ghost s06-btn-wide"
            data-material-add
            onClick={registerMaterial}
            disabled={materialLocked || !materialFormComplete || draft.sections.length === 0}
          >
            补充材料
            <span aria-hidden="true">＋</span>
          </button>
          <p className="s06-note">
            材料只作为来源登记：授权读取会更新所选小节的材料关联，并让相关确认重新核对；不会修改正文，不会自动确认，也不会发送或交给助手。
          </p>
          </div>
          {failure?.key === "material" && (
            <p className="s06-error" data-command-error="material">
              {failure.text}
            </p>
          )}
        </section>
        <p className="s06-estimate">预计人工检查 12—20 分钟</p>
        <div className="s06-checkpoint">
          <label className="s06-note">下一步（可留空）<input
            className="s06-input"
            data-checkpoint-input
            value={nextStep}
            disabled={busy !== null || interactionsLocked}
            onChange={(e) => setNextStep(e.target.value)}
            placeholder="下一步是什么？（可留空）"
          /></label>
          <button
            type="button"
            className="s06-btn-primary"
            data-checkpoint-save
            onClick={saveCheckpoint}
            disabled={busy !== null || interactionsLocked}
          >
            保存检查点
            <span aria-hidden="true">→</span>
          </button>
          {failure?.key === "checkpoint" && (
            <p className="s06-error" data-command-error="checkpoint">
              {failure.text}
            </p>
          )}
          {latestCheckpoint && (
            <div className="s06-attached" data-checkpoint-saved>
              <p className="s06-attached-title">检查点已保存 · {formatClock(latestCheckpoint.savedAt)}</p>
              <p className="s06-note">
                {latestCheckpoint.nextStep ? "下一步：" + latestCheckpoint.nextStep : "未记录下一步。"}
              </p>
              <Link
                className="s06-return-link"
                data-checkpoint-session-link
                to={"/session?checkpointId=" + encodeURIComponent(latestCheckpoint.id)}
              >
                打开恢复页
              </Link>
            </div>
          )}
        </div>
        <section className="s06-block" aria-label="撤回本地草稿" data-withdraw-block>
          <h4>不再需要这份草稿时</h4>
          <p>
            撤回只让这份本地草稿变为只读：原文、来源与历史都保留；不会撤回发送，也不会回滚估算或任何外部结果。
          </p>
          {withdrawStage === null ? (
            <button
              type="button"
              className="s06-btn-ghost s06-btn-wide"
              data-withdraw-open
              onClick={openWithdrawConfirmation}
              disabled={withdrawUnavailable}
            >
              撤回本地草稿
              <span aria-hidden="true">↩</span>
            </button>
          ) : (
            <div
              className="s06-attached"
              data-withdraw-confirm-panel
              data-withdraw-draft-id={withdrawStage.draftId}
              data-withdraw-expected-revision={withdrawStage.revision}
            >
              <p className="s06-attached-title">确认撤回这份本地草稿？</p>
              <p className="s06-note">
                只有这份本地草稿会变为只读；原文与历史保留；不会撤回发送，也不会回滚估算或任何外部结果。
              </p>
              <input
                className="s06-input"
                data-withdraw-reason
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                placeholder="原因（可留空）"
                disabled={busy !== null || interactionsLocked}
                aria-label="撤回原因（可选）"
              />
              <div className="s06-judgment-actions">
                <button
                  type="button"
                  className="s06-btn-ghost"
                  data-withdraw-cancel
                  onClick={cancelWithdraw}
                  disabled={busy !== null || interactionsLocked}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="s06-btn-ghost"
                  data-withdraw-confirm
                  onClick={confirmWithdraw}
                  disabled={busy !== null || interactionsLocked}
                >
                  {busy === "withdraw" ? "正在撤回…" : "确认撤回"}
                </button>
              </div>
              {failure?.key === "withdraw" && (
                <p className="s06-error" data-command-error="withdraw">
                  {failure.text}
                </p>
              )}
            </div>
          )}
          {failure?.key === "withdraw" && withdrawStage === null && (
            <p className="s06-error" data-command-error="withdraw">
              {failure.text}
            </p>
          )}
        </section>
        <section className="s06-block" aria-label="导出当前草稿">
          <h4>带走这份草稿</h4>
          <p>仅导出当前已保存版本的正文、来源、未决项和状态；不包含未保存编辑、其他草稿或材料正文。导出不会确认、发送或提交。</p>
          <button type="button" className="s06-btn-ghost s06-btn-wide" data-workspace-export onClick={exportDraft} disabled={busy !== null || commandState.busy || commandState.pending !== null}>导出已保存草稿（JSON）</button>
          {commandState.pending !== null && <p className="s06-note">保存结果未确认，先重试原操作再导出。</p>}
          {exportNotice && <p className={exportNotice.ok ? "s06-note" : "s06-error"} role={exportNotice.ok ? "status" : "alert"} data-workspace-export-result>{exportNotice.text}</p>}
        </section>
        <button type="button" className="s06-btn-ghost s06-btn-wide" data-refresh-readback onClick={refreshReadback} disabled={busy !== null || interactionsLocked}>
          刷新读取已保存数据
        </button>
        <p className="s06-note-center">确认后仍不会自动发送或提交</p>
      </aside>
    </div>
  );
}
