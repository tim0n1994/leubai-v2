/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_IDS,
  createDomainStore,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
  DomainState,
  Draft,
} from "./index.ts";

const NOW = "2026-09-12T11:00:00+08:00";
let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "uuid-" + uuidSeq;
}

function newStore(overrides?: { initialState?: DomainState }) {
  return createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState: overrides?.initialState,
  });
}

function newStoreWithFailingCommit(initialState: DomainState) {
  return createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState,
    commit: async () => ({
      ok: false as const,
      code: "STORAGE_WRITE_FAILED" as const,
      reason: "injected commit failure",
      retryable: false,
    }),
  });
}

function cmd<T extends CommandType>(
  type: T,
  rest: Omit<Extract<DomainCommand, { type: T }>, "type" | "commandId" | "actor" | "issuedAt"> &
    Partial<Pick<CommandBase, "actor" | "commandId">>,
): Extract<DomainCommand, { type: T }> {
  commandSeq += 1;
  return {
    type,
    commandId: rest.commandId ?? "cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

function asFailure(result: CommandResult<DomainCommand>): { code: string; reason: string; retryable: boolean } {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

const jsonOf = (value: unknown) => JSON.stringify(value);

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

async function makeAuthorizedDraft(store: ReturnType<typeof newStore>): Promise<Draft> {
  const knownDraftIds = new Set(Object.keys(store.getState().drafts));
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  asOk(await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })));
  const draft = Object.values(store.getState().drafts).find((d) => !knownDraftIds.has(d.id));
  if (!draft || draft.sections.length !== 2) throw new Error("authorized operation did not create a two-section draft");
  return draft;
}

interface Scenario {
  store: ReturnType<typeof newStore>;
  draftId: string;
  sectionAId: string;
  sectionBId: string;
  grantedMaterialId: string;
  deniedMaterialId: string;
}

// No domain command writes the legacy draft-level openQuestions field yet, so
// the scenario seeds that one field on a state clone after building everything
// else (draft, issues, materials) with real commands.
async function makeScenario(): Promise<Scenario> {
  const store = newStore();
  const draft = await makeAuthorizedDraft(store);
  const sectionAId = draft.sections[0].id;
  const sectionBId = draft.sections[1].id;
  const liveDraft = () => store.getState().drafts[draft.id];
  asOk(
    await store.execute(
      cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: liveDraft().revision, sectionId: sectionAId, issue: "需要人工核对措辞" }),
    ),
  );
  asOk(
    await store.execute(
      cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: liveDraft().revision, sectionId: sectionAId, issue: "需要人工核对措辞" }),
    ),
  );
  const granted = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: liveDraft().revision,
        name: "权威材料",
        content: "局部授权文本",
        version: 1,
        readPermission: "granted",
        sectionIds: [sectionAId],
      }),
    ),
  );
  const denied = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: liveDraft().revision,
        name: "拒绝材料",
        content: "被拒绝的文本",
        version: 3,
        readPermission: "denied",
        sectionIds: [sectionBId],
      }),
    ),
  );
  const seeded = structuredClone(store.getState());
  seeded.drafts[draft.id].openQuestions = ["整体结论仍需用户确认"];
  return {
    store: newStore({ initialState: seeded }),
    draftId: draft.id,
    sectionAId,
    sectionBId,
    grantedMaterialId: granted.material.id,
    deniedMaterialId: denied.material.id,
  };
}

test("saveCheckpoint binds the draft envelope: mismatched entityId, missing or stale expectedRevision fail without saving", async () => {
  const store = newStore();
  const draft = await makeAuthorizedDraft(store);
  const beforeEvents = store.getState().events.length;

  const fEnvelope = asFailure(
    await store.execute(cmd("saveCheckpoint", { entityId: "draft-not-this-one", expectedRevision: draft.revision, draftId: draft.id })),
  );
  assert.equal(fEnvelope.code, "INVALID_INPUT", "envelope cannot claim another draft");
  const fMissing = asFailure(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: null, draftId: draft.id })),
  );
  assert.equal(fMissing.code, "INVALID_INPUT", "missing expectedRevision cannot bind a draft");
  const fStale = asFailure(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: draft.revision - 1, draftId: draft.id })),
  );
  assert.equal(fStale.code, "REVISION_CONFLICT");
  assert.equal(fStale.retryable, true);

  const afterFailures = store.getState();
  assert.equal(Object.keys(afterFailures.checkpoints).length, 0, "rejected envelopes save no checkpoint");
  assert.equal(afterFailures.events.length, beforeEvents, "rejected envelopes publish no events");

  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: draft.revision, draftId: draft.id })),
  );
  const cp = saved.checkpoint;
  assert.equal(cp.draftId, draft.id);
  assert.equal(cp.draftVersion, draft.version);
  assert.equal(cp.draftRevision, draft.revision, "checkpoint records the bound draft revision");
  const after = store.getState();
  assert.equal(Object.keys(after.checkpoints).length, 1);
  assert.equal(after.events.length, beforeEvents + 1);
  assert.equal(after.events[after.events.length - 1].type, "checkpoint.saved");
});

test("current checkpoint captures draft-level openQuestions and both sections' open issues with section identity, deduplicated, and leaks no unrelated material", async () => {
  const scenario = await makeScenario();
  const { store, draftId } = scenario;
  const liveDraft = store.getState().drafts[draftId];
  const expectedSourceVersions: Record<string, number> = {};
  for (const section of liveDraft.sections) Object.assign(expectedSourceVersions, section.sourceVersions);

  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draftId, expectedRevision: liveDraft.revision, draftId })),
  );
  const cp = saved.checkpoint;

  assert.deepEqual(cp.openQuestions, [
    "整体结论仍需用户确认",
    "[" + scenario.sectionAId + "] 需要人工核对措辞",
    "[" + scenario.sectionBId + "] 缺少实际用时记录：成本结论未决",
  ]);
  assert.deepEqual(cp.sectionIssues, [
    { sectionId: scenario.sectionAId, issue: "需要人工核对措辞" },
    { sectionId: scenario.sectionBId, issue: "缺少实际用时记录：成本结论未决" },
  ]);
  assert.deepEqual(cp.sourceVersionSet, expectedSourceVersions, "sourceVersionSet covers exactly the bound section sources");
  assert.ok(!(scenario.deniedMaterialId in cp.sourceVersionSet), "denied material is not a bound source");

  assert.equal(cp.materials.length, 1, "only the granted associated material is captured");
  const material = cp.materials[0];
  assert.equal(material.id, scenario.grantedMaterialId);
  assert.equal(material.version, 1);
  assert.deepEqual(material.sectionIds, [scenario.sectionAId], "material section association is snapshotted");
  assert.ok(!cp.materials.some((m) => m.id === scenario.deniedMaterialId), "denied material never leaks into the checkpoint");
});

test("resume on a freshly saved checkpoint validates cleanly and mutates only the checkpoint", async () => {
  const scenario = await makeScenario();
  const { store, draftId } = scenario;
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draftId, expectedRevision: store.getState().drafts[draftId].revision, draftId })),
  );
  const draftBefore = structuredClone(store.getState().drafts[draftId]);
  const eventsBefore = store.getState().events.length;
  const data = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.equal(data.validation.requiresReview, false);
  assert.deepEqual(data.validation.notes, ["checkpoint is current; resume is safe"]);
  assert.deepEqual(data.checkpoint.resumeValidation, data.validation);
  assert.equal(jsonOf(store.getState().drafts[draftId]), jsonOf(draftBefore), "resume never touches the draft");
  assert.equal(store.getState().events.length, eventsBefore + 1);
  assert.equal(store.getState().events[store.getState().events.length - 1].type, "checkpoint.resumed");
});

test("resume marks review when a referenced material is missing, version changed, permission denied, or section association removed", async () => {
  const drifts: Array<{ label: string; mutate: (state: DomainState, materialId: string) => void; notePart: string }> = [
    {
      label: "missing",
      mutate: (state, materialId) => {
        delete state.materials[materialId];
      },
      notePart: "no longer exists",
    },
    {
      label: "version changed",
      mutate: (state, materialId) => {
        state.materials[materialId].version = 2;
      },
      notePart: "version moved",
    },
    {
      label: "permission denied",
      mutate: (state, materialId) => {
        state.materials[materialId].readPermission = "denied";
      },
      notePart: "no longer granted",
    },
    {
      label: "section association removed",
      mutate: (state, materialId) => {
        state.materials[materialId].sectionIds = [];
      },
      notePart: "section association was removed",
    },
  ];
  for (const drift of drifts) {
    const scenario = await makeScenario();
    const { store, draftId } = scenario;
    const saved = asOk(
      await store.execute(cmd("saveCheckpoint", { entityId: draftId, expectedRevision: store.getState().drafts[draftId].revision, draftId })),
    );
    const drifted = structuredClone(store.getState());
    drift.mutate(drifted, scenario.grantedMaterialId);
    const driftedStore = newStore({ initialState: drifted });
    const data = asOk(
      await driftedStore.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
    );
    assert.equal(data.validation.requiresReview, true, "drift label " + drift.label + " must require review");
    assert.ok(
      data.validation.notes.some((n) => n.includes(drift.notePart)),
      "drift label " + drift.label + " must be reported explicitly; notes: " + jsonOf(data.validation.notes),
    );
  }
});

test("withdrawn draft resume requires review and stays report-only: the draft remains withdrawn with identical text and version", async () => {
  const scenario = await makeScenario();
  const { store, draftId } = scenario;
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draftId, expectedRevision: store.getState().drafts[draftId].revision, draftId })),
  );
  const liveDraft = () => store.getState().drafts[draftId];
  asOk(await store.execute(cmd("withdrawDraft", { entityId: draftId, expectedRevision: liveDraft().revision, reason: "不再继续" })));
  const withdrawnBefore = structuredClone(liveDraft());

  const data = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.equal(data.validation.requiresReview, true);
  assert.ok(
    data.validation.notes.some((n) => n.includes("withdrawn") && n.includes("not reactivated, edited, or regenerated")),
    "withdrawn state must be reported explicitly; notes: " + jsonOf(data.validation.notes),
  );
  const after = liveDraft();
  assert.equal(jsonOf(after), jsonOf(withdrawnBefore), "resume leaves the withdrawn draft byte-identical");
  assert.equal(after.status, "withdrawn");
  assert.equal(after.version, withdrawnBefore.version);

  const sentState = structuredClone(store.getState());
  sentState.drafts[draftId].status = "sent";
  sentState.drafts[draftId].sentAt = NOW;
  sentState.checkpoints[saved.checkpoint.id].revision = saved.checkpoint.revision;
  sentState.checkpoints[saved.checkpoint.id].resumeValidation = null;
  const sentStore = newStore({ initialState: sentState });
  const sentData = asOk(
    await sentStore.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.equal(sentData.validation.requiresReview, true);
  assert.ok(
    sentData.validation.notes.some((n) => n.includes("sent") && n.includes("not reactivated, edited, or regenerated")),
    "sent state must be reported explicitly; notes: " + jsonOf(sentData.validation.notes),
  );
});

test("legacy checkpoints without the new optional metadata resume only with conservative review", async () => {
  const scenario = await makeScenario();
  const { store, draftId } = scenario;
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draftId, expectedRevision: store.getState().drafts[draftId].revision, draftId })),
  );
  const legacy = structuredClone(store.getState());
  const legacyCp = legacy.checkpoints[saved.checkpoint.id];
  delete legacyCp.draftRevision;
  delete legacyCp.sectionIssues;
  delete legacyCp.materials[0].sectionIds;
  const legacyStore = newStore({ initialState: legacy });
  const data = asOk(
    await legacyStore.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.equal(data.validation.requiresReview, true, "completeness cannot be proved without the new metadata");
  assert.ok(
    data.validation.notes.some((n) => n.includes("completeness cannot be proved")),
    "legacy metadata gap must be reported; notes: " + jsonOf(data.validation.notes),
  );
});

test("a failing commit publishes neither the saved checkpoint nor the resume validation", async () => {
  const store = newStore();
  const draft = await makeAuthorizedDraft(store);
  const stateWithDraft = structuredClone(store.getState());
  const failingSave = newStoreWithFailingCommit(stateWithDraft);
  const fSave = asFailure(
    await failingSave.execute(
      cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: stateWithDraft.drafts[draft.id].revision, draftId: draft.id }),
    ),
  );
  assert.equal(fSave.code, "STORAGE_WRITE_FAILED");
  assert.equal(Object.keys(failingSave.getState().checkpoints).length, 0, "failed commit saves no checkpoint");
  assert.equal(failingSave.getState().events.length, stateWithDraft.events.length, "failed commit appends no event");
  assert.equal(failingSave.getState().globalRevision, stateWithDraft.globalRevision);

  const committed = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: store.getState().drafts[draft.id].revision, draftId: draft.id })),
  );
  const stateWithCheckpoint = structuredClone(store.getState());
  const failingResume = newStoreWithFailingCommit(stateWithCheckpoint);
  const fResume = asFailure(
    await failingResume.execute(
      cmd("resumeCheckpoint", { entityId: committed.checkpoint.id, expectedRevision: committed.checkpoint.revision }),
    ),
  );
  assert.equal(fResume.code, "STORAGE_WRITE_FAILED");
  assert.equal(failingResume.getState().checkpoints[committed.checkpoint.id].resumeValidation, null, "failed commit stores no validation");
  assert.equal(failingResume.getState().events.length, stateWithCheckpoint.events.length);
  assert.equal(failingResume.getState().globalRevision, stateWithCheckpoint.globalRevision);
});

test("no-draft checkpoint remains a supported path with null entity/revision and empty material/source sets", async () => {
  const store = newStore();
  const eventsBefore = store.getState().events.length;
  const saved = asOk(await store.execute(cmd("saveCheckpoint", { entityId: null, expectedRevision: null })));
  const cp = saved.checkpoint;
  assert.equal(cp.draftId, null);
  assert.equal(cp.draftVersion, null);
  assert.equal(cp.draftRevision, null);
  assert.deepEqual(cp.sourceVersionSet, {});
  assert.deepEqual(cp.materials, []);
  assert.deepEqual(cp.openQuestions, []);
  assert.deepEqual(cp.sectionIssues, []);
  assert.equal(store.getState().events.length, eventsBefore + 1);
});

test("resume requires review when flagSectionIssue moves the draft revision without moving version", async () => {
  const store = newStore();
  const draft = await makeAuthorizedDraft(store);
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: store.getState().drafts[draft.id].revision, draftId: draft.id })),
  );
  const liveDraft = () => store.getState().drafts[draft.id];
  asOk(
    await store.execute(
      cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: liveDraft().revision, sectionId: draft.sections[0].id, issue: "保存后发现的新问题" }),
    ),
  );
  const afterFlag = liveDraft();
  assert.equal(afterFlag.version, saved.checkpoint.draftVersion, "flagSectionIssue must not move the draft version");
  assert.equal(afterFlag.sections[0].contentVersion, draft.sections[0].contentVersion, "flagSectionIssue must not move the section contentVersion");
  assert.ok(
    typeof saved.checkpoint.draftRevision === "number" && afterFlag.revision > saved.checkpoint.draftRevision,
    "flagSectionIssue moves the draft revision",
  );
  const draftBeforeResume = structuredClone(afterFlag);
  const data = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.equal(data.validation.requiresReview, true, "a revision-only move must require review");
  assert.ok(
    data.validation.notes.some((n) => n.includes("revision moved")),
    "the revision move must be reported explicitly; notes: " + jsonOf(data.validation.notes),
  );
  assert.equal(jsonOf(store.getState().drafts[draft.id]), jsonOf(draftBeforeResume), "resume stays report-only with no draft mutation or snapshot rewrite");
  const snapshotIssues = data.checkpoint.sectionIssues ?? [];
  assert.ok(
    !snapshotIssues.some((entry) => entry.issue === "保存后发现的新问题"),
    "resume must not retroactively rewrite the snapshot issue list",
  );
});

test("no-draft saveCheckpoint rejects stray entityId or expectedRevision without any state change", async () => {
  const store = newStore();
  const before = store.getState();
  const fEntity = asFailure(await store.execute(cmd("saveCheckpoint", { entityId: "stray-draft", expectedRevision: null })));
  assert.equal(fEntity.code, "INVALID_INPUT", "a no-draft checkpoint cannot carry a stray entityId");
  const fRevision = asFailure(await store.execute(cmd("saveCheckpoint", { entityId: null, expectedRevision: 3 })));
  assert.equal(fRevision.code, "INVALID_INPUT", "a no-draft checkpoint cannot carry a stray expectedRevision");
  const after = store.getState();
  assert.equal(Object.keys(after.checkpoints).length, Object.keys(before.checkpoints).length, "rejected envelopes save no checkpoint");
  assert.equal(after.events.length, before.events.length, "rejected envelopes publish no events");
  assert.equal(after.globalRevision, before.globalRevision, "rejected envelopes move no global revision");
  const saved = asOk(await store.execute(cmd("saveCheckpoint", { entityId: null, expectedRevision: null })));
  assert.equal(saved.checkpoint.draftId, null, "genuine null/null no-draft checkpoints still work");
  assert.equal(store.getState().events.length, before.events.length + 1);
});
