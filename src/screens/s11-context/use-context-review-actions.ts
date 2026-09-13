import { useRef, useState } from "react";
import type { DomainStore } from "../../domain/store.ts";
import type { ContextReviewAction } from "../../domain/contextReviewModel.ts";
import type { ContextReviewCommand } from "../../domain/types.ts";

export function useContextReviewActions(store: DomainStore) {
	const [busy, setBusy] = useState(false);
	const [retryable, setRetryable] = useState(false);
	const [message, setMessage] = useState("");
	const pending = useRef<ContextReviewCommand | null>(null);
	const executing = useRef(false);
	const send = async (command: ContextReviewCommand) => {
		if (executing.current) return;
		executing.current = true;
		setBusy(true);
		try {
			const result = await store.execute(command);
			if (result.ok) {
				pending.current = null;
				setMessage("已保存到本地记录。");
			} else {
				pending.current = result.retryable ? command : null;
				setMessage("未确认保存：" + result.reason);
			}
		} catch (error) {
			pending.current = command;
			setMessage(
				"保存结果尚未确认：" +
					(error instanceof Error ? error.message : String(error)),
			);
		} finally {
			executing.current = false;
			setBusy(false);
			setRetryable(pending.current !== null);
		}
	};
	return {
		busy,
		message,
		retryable,
		run(action: ContextReviewAction) {
			return send({
				type: "contextReviewAction",
				action,
				commandId: crypto.randomUUID(),
				entityId: null,
				expectedRevision: store.getState().globalRevision,
				actor: "user",
				issuedAt: new Date().toISOString(),
			});
		},
		retry() {
			if (pending.current) return send(pending.current);
		},
	};
}
