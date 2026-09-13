import type { ReactNode } from "react";
import { useDomainRuntime } from "../../runtime/index.ts";
import type { DomainStore } from "../../domain/store.ts";

export function ContextReviewSurface({
	children,
}: {
	children: (store: DomainStore) => ReactNode;
}) {
	const runtime = useDomainRuntime();
	if (runtime.status === "loading")
		return <p role="status">正在读取本地记录。</p>;
	if (runtime.status !== "ready")
		return (
			<p role="alert">记录暂时无法读取：{runtime.reason}。现有数据未被清除。</p>
		);
	return children(runtime.runtime.store);
}
