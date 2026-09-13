import { useEffect, useRef, useState } from "react";
import { describeLlmError, generateWithLlm } from "./llmClient";
import { LlmApiError } from "./llmClient";
import "./settings.css";

interface DraftAssistantProps {
  input: string;
  onApply: (text: string) => Promise<void>;
}

type AssistantPhase = "idle" | "generating" | "applying";

export function DraftAssistant(props: DraftAssistantProps) {
  return <DraftAssistantSession key={props.input} {...props} />;
}

function DraftAssistantSession({ input, onApply }: DraftAssistantProps) {
  const [proposal, setProposal] = useState<string | null>(null);
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const applySeqRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      runRef.current += 1;
      applySeqRef.current += 1;
    };
  }, []);

  const canGenerate = input.trim().length > 0 && phase === "idle";

  const handleGenerate = async () => {
    if (!canGenerate) return;
    const run = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("generating");
    setError(null);
    try {
      const result = await generateWithLlm({
        purpose: "draft",
        input,
        signal: controller.signal,
      });
      if (runRef.current !== run) return;
      setProposal(result.text);
      setPhase("idle");
    } catch (err) {
      if (runRef.current !== run || controller.signal.aborted) return;
      setPhase("idle");
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setError(describeLlmError(code));
    }
  };

  const handleApply = async () => {
    if (!proposal || phase !== "idle") return;
    const applyId = ++applySeqRef.current;
    const applying = proposal;
    setPhase("applying");
    setError(null);
    try {
      await onApply(applying);
      if (applySeqRef.current !== applyId) return;
      setProposal(null);
    } catch {
      // Uncertain write: the stored draft state is unknown, keep the proposal.
      if (applySeqRef.current !== applyId) return;
      setError("应用结果未确认，草稿状态未知；建议已保留，请重试或手动检查草稿。");
    } finally {
      if (applySeqRef.current === applyId) setPhase("idle");
    }
  };

  return (
    <section className="draft-assistant" aria-label="草稿助手">
      <div className="draft-assistant-head">
        <span className="draft-assistant-title">草稿助手</span>
        <span className="draft-assistant-note">仅发送当前输入文本；生成结果需手动应用</span>
      </div>
      <pre className="draft-assistant-outbound" data-testid="draft-outbound-preview">
        {input.trim() ? input : "（输入为空）"}
      </pre>
      <button
        type="button"
        className="settings-btn"
        data-testid="draft-generate"
        disabled={!canGenerate}
        onClick={() => {
          void handleGenerate();
        }}
      >
        {phase === "generating" ? "生成中…" : "生成草稿建议"}
      </button>
      {error ? (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      {proposal !== null ? (
        <div className="draft-assistant-proposal">
          <span className="draft-assistant-title">生成结果预览</span>
          <pre className="draft-assistant-preview" data-testid="draft-output-preview">
            {proposal}
          </pre>
          <button
            type="button"
            className="settings-btn is-primary"
            data-testid="draft-apply"
            disabled={phase !== "idle"}
            onClick={() => {
              void handleApply();
            }}
          >
            {phase === "applying" ? "应用中…" : "应用到草稿"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
