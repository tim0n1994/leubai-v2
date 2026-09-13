import { useRef, useState } from "react";
import type { DomainStore, PlanKind } from "../../domain/index.ts";
import { preparePlan } from "./planPreparation.ts";
import type { PlanSelectOffer } from "./planSurfaces.ts";

export function PreparePlanButton({ store, intentId, kind, offer, href, className, navigate }: {
  store: DomainStore; intentId: string; kind: PlanKind; offer: PlanSelectOffer; href: string;
  className: string; navigate: (href: string) => void;
}) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (running.current || offer.action === "blocked") return;
    if (offer.action === "view") { navigate(href); return; }
    running.current = true;
    setPending(true);
    setError(null);
    try { await preparePlan(store, intentId, kind); navigate(href); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setPending(false); }
  };
  return <>
    <button type="button" className={className} disabled={pending || offer.action === "blocked"} onClick={() => void run()}>
      {pending ? "正在准备…" : offer.action === "create" ? "准备方案 " + kind + " 并预览" : offer.label}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
