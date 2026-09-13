import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { DomainStore } from "../../domain/store.ts";
import type {
	Intent,
	IntentLifecycleCommand,
	ParsedFields,
} from "../../domain/types.ts";

const STATUS = {
	saved: "已保存",
	ambiguous: "待澄清",
	paused: "已暂停",
	deleted: "已删除",
	discarded: "已丢弃",
};

export function IntentCard({
	intent,
	store,
}: {
	intent: Intent;
	store: DomainStore;
}) {
	const [editing, setEditing] = useState<Intent | null>(null);
	const [deleting, setDeleting] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [retryCommand, setRetryCommand] =
		useState<IntentLifecycleCommand | null>(null);
	const running = useRef(false);
	const terminal = intent.status === "deleted" || intent.status === "discarded";
	const commandBase = (revision: number) => ({
		commandId: crypto.randomUUID(),
		entityId: intent.id,
		expectedRevision: revision,
		actor: "user" as const,
		issuedAt: new Date().toISOString(),
	});
	const send = async (command: IntentLifecycleCommand) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setMessage("");
		try {
			const result = await store.execute(command);
			if (result.ok) {
				setEditing(null);
				setDeleting(null);
				setRetryCommand(null);
				setMessage(
					command.type === "deleteIntent"
						? "当前意图与关联录入文本已删除；历史责任与最小删除标记保留。"
						: "已保存。旧方案需重新预览与授权，已承担的责任保持不变。",
				);
			} else {
				setRetryCommand(
					result.retryable && result.code !== "REVISION_CONFLICT"
						? command
						: null,
				);
				setMessage(
					result.code === "REVISION_CONFLICT"
						? "记录已在其他页面变更。请取消编辑并重新打开最新版本。"
						: "未确认保存：" + result.reason,
				);
			}
		} catch (error) {
			setRetryCommand(command);
			setMessage(
				"保存结果未确认，请重试原操作：" +
					(error instanceof Error ? error.message : String(error)),
			);
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const editField = (key: keyof ParsedFields, value: string) =>
		setEditing((current) =>
			current
				? {
						...current,
						parsedFields: {
							...current.parsedFields,
							[key]: value === "" ? null : value,
						},
					}
				: current,
		);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!editing) return;
		void send({
			...commandBase(editing.revision),
			type: "editIntent",
			verbatim: editing.verbatim,
			parsedFields: editing.parsedFields,
			constraints: editing.constraints,
		});
	};
	return (
		<div className="s11-card s11-intent-card">
			<p className="s11-card-line">
				{terminal
					? "此意图已删除或丢弃"
					: intent.verbatim || intent.parsedFields.topic || "保留空白"}
			</p>
			<p className="s11-card-src">
				{intent.dataMode === "fixture" ? "演示空间记录" : "本人记录"} ·{" "}
				{STATUS[intent.status]} · 版本 {intent.revision}
			</p>
			{!terminal && (
				<p className="s11-note">
					{intent.parsedFields.date ?? "日期待确认"}{" "}
					{intent.parsedFields.startTime}—{intent.parsedFields.endTime} ·{" "}
					{intent.parsedFields.timezone ?? "时区待确认"}
				</p>
			)}
			{terminal ? (
				<p className="s11-note">
					只保留最小标记。不会继续用于新的方案，已承担的责任和保护时段仍然保留。
				</p>
			) : editing ? (
				<form
					className="s11-intent-editor"
					onSubmit={submit}
					aria-label="编辑意图"
				>
					<fieldset disabled={busy || retryCommand !== null}>
						<legend>修改这条意图</legend>
						{intent.channel !== "manual" && (
							<label>
								意图原文
								<textarea
									required
									value={editing.verbatim}
									onChange={(event) =>
										setEditing((current) =>
											current
												? { ...current, verbatim: event.target.value }
												: current,
										)
									}
								/>
							</label>
						)}
						<div className="s11-intent-fields">
							<label>
								日期
								<input
									type="date"
									required={intent.channel === "manual"}
									value={editing.parsedFields.date ?? ""}
									onChange={(event) => editField("date", event.target.value)}
								/>
							</label>
							<label>
								开始时间
								<input
									type="time"
									required={intent.channel === "manual"}
									value={editing.parsedFields.startTime ?? ""}
									onChange={(event) =>
										editField("startTime", event.target.value)
									}
								/>
							</label>
							<label>
								结束时间
								<input
									type="time"
									required={intent.channel === "manual"}
									value={editing.parsedFields.endTime ?? ""}
									onChange={(event) => editField("endTime", event.target.value)}
								/>
							</label>
						</div>
						<label>
							时区
							<input
								required={intent.channel === "manual"}
								value={editing.parsedFields.timezone ?? ""}
								onChange={(event) => editField("timezone", event.target.value)}
								placeholder="Asia/Shanghai"
							/>
						</label>
						<label>
							想做的事（可留空）
							<input
								value={editing.parsedFields.topic ?? ""}
								onChange={(event) => editField("topic", event.target.value)}
							/>
						</label>
						<p className="s11-note">主题留空表示保留空白，不会自动填入任务。</p>
						{editing.constraints.map((constraint, index) => (
							<div className="s11-intent-constraint" key={constraint.id}>
								<label>
									约束 {index + 1}
									<input
										required
										value={constraint.expression}
										onChange={(event) =>
											setEditing((current) =>
												current
													? {
															...current,
															constraints: current.constraints.map((item) =>
																item.id === constraint.id
																	? {
																			...item,
																			expression: event.target.value,
																			confirmed: true,
																		}
																	: item,
															),
														}
													: current,
											)
										}
									/>
								</label>
								<button
									type="button"
									className="s11-btn s11-btn-ghost"
									onClick={() =>
										setEditing((current) =>
											current
												? {
														...current,
														constraints: current.constraints.filter(
															(item) => item.id !== constraint.id,
														),
													}
												: current,
										)
									}
								>
									移除此约束
								</button>
							</div>
						))}
						<button
							type="button"
							className="s11-btn s11-btn-ghost"
							onClick={() =>
								setEditing((current) =>
									current
										? {
												...current,
												constraints: [
													...current.constraints,
													{
														id: crypto.randomUUID(),
														kind: "protect",
														expression: "",
														confirmed: true,
													},
												],
											}
										: current,
								)
							}
						>
							添加约束
						</button>
					</fieldset>
					<p className="s11-note">
						保存将使旧方案与未消费授权失效；不会自动改动既有日程或撤销已承担的责任。暂停中的意图保存后仍保持暂停。
					</p>
					<div className="s11-actions">
						<button
							type="submit"
							className="s11-btn"
							disabled={busy || retryCommand !== null}
						>
							保存修改
						</button>
						<button
							type="button"
							className="s11-btn s11-btn-ghost"
							disabled={busy || retryCommand !== null}
							onClick={() => {
								setEditing(null);
								setMessage("");
							}}
						>
							取消编辑
						</button>
					</div>
				</form>
			) : deleting !== null ? (
				<div
					className="s11-intent-delete"
					role="group"
					aria-label="确认删除意图"
				>
					<p>
						删除当前意图及关联录入中的文本、字段和约束。保留最小删除标记，已承担的责任、保护时段、既有操作记录和外部副本不会自动撤销或抹去。
					</p>
					<div className="s11-actions">
						<button
							type="button"
							className="s11-btn"
							disabled={busy || retryCommand !== null}
							onClick={() =>
								void send({ ...commandBase(deleting), type: "deleteIntent" })
							}
						>
							确认删除这条意图
						</button>
						<button
							type="button"
							className="s11-btn s11-btn-ghost"
							disabled={busy || retryCommand !== null}
							onClick={() => setDeleting(null)}
						>
							取消删除
						</button>
					</div>
				</div>
			) : (
				<div className="s11-actions">
					<button
						type="button"
						className="s11-btn"
						disabled={busy || retryCommand !== null}
						onClick={() => {
							setEditing(structuredClone(intent));
							setMessage("");
						}}
					>
						编辑意图
					</button>
					<button
						type="button"
						className="s11-btn s11-btn-ghost"
						disabled={busy || retryCommand !== null}
						onClick={() =>
							void send({
								...commandBase(intent.revision),
								type:
									intent.status === "paused" ? "resumeIntent" : "pauseIntent",
							})
						}
					>
						{intent.status === "paused" ? "恢复使用" : "暂停使用"}
					</button>
					<button
						type="button"
						className="s11-btn s11-btn-ghost"
						disabled={busy || retryCommand !== null}
						onClick={() => setDeleting(intent.revision)}
					>
						删除意图
					</button>
				</div>
			)}
			{!terminal && intent.status === "paused" && (
				<p className="s11-note">
					已暂停未来使用；已有责任和保护时段不会自动取消。恢复后需要重新生成与批准方案。
				</p>
			)}
			{message && (
				<p role="status" className="s11-note">
					{message}
				</p>
			)}
			{retryCommand && (
				<button
					type="button"
					className="s11-btn"
					disabled={busy}
					onClick={() => void send(retryCommand)}
				>
					重试保存原操作
				</button>
			)}
		</div>
	);
}
