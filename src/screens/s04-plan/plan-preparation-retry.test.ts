import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, FIXTURE_IDS } from "../../domain/index.ts";
import type { DomainCommand, DomainStore } from "../../domain/index.ts";
import { preparePlan } from "./planPreparation.ts";
import { workflowCommands } from "./workflow-command.ts";

test("pending preparation retains full command after another commit advances global revision", async () => {
  let unknown = true;
  const commands: DomainCommand[] = [];
  const base = createDomainStore({ dataMode: "fixture", commit: async () => {
    if (unknown) { unknown = false; return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "unknown readback", retryable: true }; }
    return { ok: true };
  } });
  const store: DomainStore = { ...base, execute: command => { commands.push(structuredClone(command)); return base.execute(command); } };
  await assert.rejects(preparePlan(store, FIXTURE_IDS.intent, "A"));
  const intent = store.getState().intents[FIXTURE_IDS.intent];
  const other = await base.execute({ type: "saveIntent", commandId: "other-write", entityId: null, expectedRevision: null, actor: "user", issuedAt: "2026-09-13T10:00:00Z", raw: "another saved intent", channel: "text", parsedFields: intent.parsedFields, constraints: [] });
  assert.equal(other.ok, true);
  await preparePlan(store, FIXTURE_IDS.intent, "A").catch(() => undefined);
  const selects = commands.filter(command => command.type === "selectPlan");
  assert.equal(selects.length, 2);
  assert.deepEqual(selects[1], selects[0]);
  assert.equal(workflowCommands(store).getSnapshot().pending?.uncertain, true);
});
