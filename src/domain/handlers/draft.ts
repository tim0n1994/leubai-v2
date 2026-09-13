import { fail, ok } from "../store.ts";
import { captureRulesSnapshot } from "../checkpointRulesModel.ts";
import type { Handler } from "../store.ts";
import type {
  Checkpoint,
  CommandType,
  DomainState,
  Draft,
  DraftSection,
  EntityId,
  Material,
} from "../types.ts";
import { bump, finish, lookupEntity, requireRevision, requireUser } from "./shared.ts";

function derivedBase(state: DomainState, ctx: Parameters<Handler>[2]) {
  return {
    id: ctx.uuid(),
    revision: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    dataMode: state.dataMode,
    provenance: { origin: "derived" as const },
  };
}

function draftStatusAfter(sections: DraftSection[]): Draft["status"] {
  const confirmed = sections.filter((s) => s.reviewStatus === "confirmed").length;
  return confirmed === 0 ? "pendingReview" : "partiallyConfirmed";
}

function unionSourceVersions(sections: DraftSection[]): Record<EntityId, number> {
  const out: Record<EntityId, number> = {};
  for (const section of sections) {
    for (const [sid, v] of Object.entries(section.sourceVersions)) {
      out[sid] = v;
    }
  }
  return out;
}

type BoundRefScope = { draftId: EntityId; sectionId: EntityId | null };

type BoundRefResolution = { stale: false } | { stale: true; reason: string };

function resolveBoundRef(
  state: DomainState,
  refId: EntityId,
  boundVersion: number,
  scope: BoundRefScope,
): BoundRefResolution {
  const source = state.sources[refId];
  if (source) {
    if (source.sourceVersion !== boundVersion) {
      return {
        stale: true,
        reason: refId + " bound version " + boundVersion + " but current is " + source.sourceVersion,
      };
    }
    return { stale: false };
  }
  const material = state.materials[refId];
  if (material) {
    if (material.readPermission !== "granted") {
      return { stale: true, reason: refId + " is not explicitly granted for read use" };
    }
    if (!state.ruleset.grants.readMaterial) {
      return { stale: true, reason: refId + " cannot be used while the global readMaterial grant is revoked" };
    }
    if (material.draftId !== scope.draftId) {
      return { stale: true, reason: refId + " is not linked to this draft" };
    }
    if (scope.sectionId !== null && !(material.sectionIds ?? []).includes(scope.sectionId)) {
      return { stale: true, reason: refId + " is not linked to this section" };
    }
    if (material.version !== boundVersion) {
      return {
        stale: true,
        reason: refId + " bound version " + boundVersion + " but current is " + material.version,
      };
    }
    return { stale: false };
  }
  return { stale: true, reason: refId + " no longer exists" };
}

function firstStaleBoundReason(state: DomainState, section: DraftSection, draftId: EntityId): string | null {
  for (const [refId, boundVersion] of Object.entries(section.sourceVersions)) {
    const resolution = resolveBoundRef(state, refId, boundVersion, { draftId, sectionId: section.id });
    if (resolution.stale) return resolution.reason;
  }
  return null;
}

export const draftHandlers: Partial<Record<CommandType, Handler>> = {
  confirmSections: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "confirmSections" }>;
    const userFail = requireUser(c.actor, "confirmSections");
    if (userFail) return userFail;
    const draftLookup = lookupEntity(state.drafts, c.entityId, "draft");
    if (draftLookup.failure) return draftLookup.failure;
    const draft = draftLookup.entity;
    const revisionFail = requireRevision(draft.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (draft.sentAt) return fail("INVALID_TRANSITION", "draft was already sent and can no longer be confirmed", false);
    if (draft.status === "withdrawn") return fail("INVALID_TRANSITION", "draft was withdrawn and can no longer be confirmed", false);
    const rejected: Array<{ sectionId: EntityId; reason: string }> = [];
    const sections = draft.sections.map((section) => {
      const request = c.sections.find((s) => s.sectionId === section.id);
      if (!request) return section;
      if (request.expectedContentVersion !== section.contentVersion) {
        rejected.push({
          sectionId: section.id,
          reason: "content moved: expected version " + request.expectedContentVersion + " but current is " + section.contentVersion,
        });
        return section;
      }
      const staleReason = firstStaleBoundReason(state, section, draft.id);
      if (staleReason) {
        rejected.push({
          sectionId: section.id,
          reason: "bound source moved since the draft was generated: " + staleReason,
        });
        return section;
      }
      return { ...section, reviewStatus: "confirmed" as const, confirmedBy: c.actor, confirmedAt: ctx.now };
    });
    const updated: Draft = { ...bump(draft, ctx.now), sections, status: draftStatusAfter(sections) };
    const nextState = finish(
      state,
      { drafts: { ...state.drafts, [updated.id]: updated } },
      [{ entityId: updated.id, before: draft.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "draft.sectionsConfirmed",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "confirmed " + (c.sections.length - rejected.length) + " section(s); open issues retained; draft not sent",
      },
    );
    return ok(nextState, { draft: updated, rejected });
  },

  editDraftSection: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "editDraftSection" }>;
    const userFail = requireUser(c.actor, "editDraftSection");
    if (userFail) return userFail;
    if (typeof c.content !== "string") {
      return fail("INVALID_INPUT", "editDraftSection content must be a string (empty string is allowed)", false);
    }
    const draftLookup = lookupEntity(state.drafts, c.entityId, "draft");
    if (draftLookup.failure) return draftLookup.failure;
    const draft = draftLookup.entity;
    const revisionFail = requireRevision(draft.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (draft.sentAt) return fail("INVALID_TRANSITION", "draft was already sent and can no longer be edited", false);
    if (draft.status === "withdrawn") return fail("INVALID_TRANSITION", "draft was withdrawn and can no longer be edited", false);
    const section = draft.sections.find((s) => s.id === c.sectionId);
    if (!section) return fail("ENTITY_NOT_FOUND", "section not found: " + c.sectionId, false);
    if (c.expectedContentVersion !== section.contentVersion) {
      return fail(
        "CONFLICT",
        "section content moved: expected version " + c.expectedContentVersion + " but current is " + section.contentVersion,
        true,
      );
    }
    const staleReason = firstStaleBoundReason(state, section, draft.id);
    if (staleReason) {
      return fail("CONFLICT", "bound source moved since the draft was generated: " + staleReason, true);
    }
    const wasConfirmed = section.reviewStatus === "confirmed";
    const updatedSection: DraftSection = {
      ...section,
      content: c.content,
      contentVersion: section.contentVersion + 1,
      reviewStatus: "pendingReview" as const,
      confirmedBy: null,
      confirmedAt: null,
      confirmationInvalidReason: wasConfirmed
        ? "content edited after confirmation: user applied new text"
        : section.confirmationInvalidReason,
    };
    const sections = draft.sections.map((s) => (s.id === section.id ? updatedSection : s));
    const updated: Draft = {
      ...bump(draft, ctx.now),
      version: draft.version + 1,
      sections,
      status: draftStatusAfter(sections),
    };
    const nextState = finish(
      state,
      { drafts: { ...state.drafts, [updated.id]: updated } },
      [{ entityId: updated.id, before: draft.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "draft.sectionEdited",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "user edited one section; its confirmation is invalidated; source refs and open issues retained; draft not sent",
      },
    );
    return ok(nextState, { draft: updated });
  },

  flagSectionIssue: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "flagSectionIssue" }>;
    const userFail = requireUser(c.actor, "flagSectionIssue");
    if (userFail) return userFail;
    const draftLookup = lookupEntity(state.drafts, c.entityId, "draft");
    if (draftLookup.failure) return draftLookup.failure;
    const draft = draftLookup.entity;
    const revisionFail = requireRevision(draft.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (draft.status === "withdrawn") return fail("INVALID_TRANSITION", "draft was withdrawn and can no longer be flagged", false);
    const section = draft.sections.find((s) => s.id === c.sectionId);
    if (!section) return fail("ENTITY_NOT_FOUND", "section not found: " + c.sectionId, false);
    const wasConfirmed = section.reviewStatus === "confirmed";
    const updatedSection: DraftSection = {
      ...section,
      openIssues: [...section.openIssues, c.issue],
      reviewStatus: "pendingReview",
      confirmedBy: wasConfirmed ? null : section.confirmedBy,
      confirmedAt: wasConfirmed ? null : section.confirmedAt,
      confirmationInvalidReason: wasConfirmed ? "issue flagged after confirmation: " + c.issue : section.confirmationInvalidReason,
    };
    const sections = draft.sections.map((s) => (s.id === section.id ? updatedSection : s));
    const updated: Draft = { ...bump(draft, ctx.now), sections, status: draftStatusAfter(sections) };
    const nextState = finish(
      state,
      { drafts: { ...state.drafts, [updated.id]: updated } },
      [{ entityId: updated.id, before: draft.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "draft.sectionIssueFlagged",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "user flagged an issue; section kept unconfirmed",
      },
    );
    return ok(nextState, { draft: updated });
  },

  saveCheckpoint: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "saveCheckpoint" }>;
    const userFail = requireUser(c.actor, "saveCheckpoint");
    if (userFail) return userFail;
    let draft: Draft | null = null;
    if (c.draftId) {
      if (c.entityId !== c.draftId) {
        return fail("INVALID_INPUT", "saveCheckpoint envelope entityId must equal the bound draftId", false);
      }
      if (c.expectedRevision === null) {
        return fail("INVALID_INPUT", "saveCheckpoint requires expectedRevision when binding a draft", false);
      }
     const draftLookup = lookupEntity(state.drafts, c.draftId, "draft");
     if (draftLookup.failure) return draftLookup.failure;
     draft = draftLookup.entity;
     const revisionFail = requireRevision(draft.revision, c.expectedRevision);
     if (revisionFail) return revisionFail;
    } else {
      if (c.entityId !== null || c.expectedRevision !== null) {
        return fail("INVALID_INPUT", "no-draft saveCheckpoint requires entityId:null and expectedRevision:null", false);
      }
    }
    const appliedRefIds = new Set<EntityId>();
    const sectionIssues: Array<{ sectionId: EntityId; issue: string }> = [];
    const seenIssues = new Set<string>();
    if (draft) {
      for (const section of draft.sections) {
        for (const ref of section.sourceRefs) appliedRefIds.add(ref);
        for (const issue of section.openIssues) {
          const dedupeKey = section.id + "\u0000" + issue;
          if (!seenIssues.has(dedupeKey)) {
            seenIssues.add(dedupeKey);
            sectionIssues.push({ sectionId: section.id, issue });
          }
        }
      }
    }
    const openQuestionSet = new Set<string>();
    for (const question of draft?.openQuestions ?? []) openQuestionSet.add(question);
    for (const entry of sectionIssues) openQuestionSet.add("[" + entry.sectionId + "] " + entry.issue);
    const checkpoint: Checkpoint = {
      rulesSnapshot: captureRulesSnapshot(state.ruleset),
      ...derivedBase(state, ctx),
      id: ctx.uuid(),
      draftId: draft?.id ?? null,
      draftVersion: draft?.version ?? null,
      draftRevision: draft?.revision ?? null,
      sourceVersionSet: draft ? unionSourceVersions(draft.sections) : {},
      confirmedDecisions: draft
        ? draft.sections
            .filter((s) => s.reviewStatus === "confirmed")
            .map((s) => ({ sectionId: s.id, contentVersion: s.contentVersion, note: "confirmed by user" }))
        : [],
      openQuestions: [...openQuestionSet],
      sectionIssues,
      materials: draft
        ? Object.values(state.materials)
            .filter((m) => m.draftId === draft.id && m.readPermission === "granted" && appliedRefIds.has(m.id))
            .map((m) => ({ id: m.id, name: m.name, version: m.version, accessRef: m.accessRef ?? null, sectionIds: [...(m.sectionIds ?? [])] }))
        : [],
      nextStep: c.nextStep ?? null,
      savedAt: ctx.now,
      resumeValidation: null,
    };
    const nextState = finish(
      state,
      { checkpoints: { ...state.checkpoints, [checkpoint.id]: checkpoint } },
      [{ entityId: checkpoint.id, before: 0, after: 1 }],
      {
        eventId: ctx.uuid(),
        type: "checkpoint.saved",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "checkpoint saved with bound draft revision and actual source versions",
      },
    );
    return ok(nextState, { checkpoint });
  },

  resumeCheckpoint: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "resumeCheckpoint" }>;
    const userFail = requireUser(c.actor, "resumeCheckpoint");
    if (userFail) return userFail;
    const cpLookup = lookupEntity(state.checkpoints, c.entityId, "checkpoint");
    if (cpLookup.failure) return cpLookup.failure;
    const checkpoint = cpLookup.entity;
    const revisionFail = requireRevision(checkpoint.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    const staleSourceIds: EntityId[] = [];
    for (const [sid, boundVersion] of Object.entries(checkpoint.sourceVersionSet)) {
      const resolution = resolveBoundRef(state, sid, boundVersion, { draftId: checkpoint.draftId ?? "", sectionId: null });
      if (resolution.stale) staleSourceIds.push(sid);
    }
    const draft = checkpoint.draftId ? state.drafts[checkpoint.draftId] : null;
    const draftVersionMoved = checkpoint.draftVersion !== null && (!draft || draft.version !== checkpoint.draftVersion);
    const draftRevisionMoved =
      checkpoint.draftRevision !== undefined &&
      checkpoint.draftRevision !== null &&
      (!draft || draft.revision !== checkpoint.draftRevision);
    const draftMoved = draftVersionMoved || draftRevisionMoved;
    const confirmedMismatch = checkpoint.confirmedDecisions.some((cd) => {
      const section = draft?.sections.find((s) => s.id === cd.sectionId);
      return !section || section.contentVersion !== cd.contentVersion || section.reviewStatus !== "confirmed";
    });
    const legacyMetadataIncomplete =
      checkpoint.draftId !== null &&
      (checkpoint.draftRevision === undefined ||
        checkpoint.sectionIssues === undefined ||
        checkpoint.materials.some((m) => m.sectionIds === undefined));
    const materialNotes: string[] = [];
    for (const entry of checkpoint.materials) {
      const material = state.materials[entry.id];
      if (!material) {
        materialNotes.push("checkpoint material no longer exists: " + entry.id);
        continue;
      }
      if (material.version !== entry.version) {
        materialNotes.push("checkpoint material version moved: " + entry.id + " bound " + entry.version + " but current is " + material.version);
        continue;
      }
      if (material.readPermission !== "granted") {
        materialNotes.push("checkpoint material read permission is no longer granted: " + entry.id);
        continue;
      }
      if (!state.ruleset.grants.readMaterial) {
        materialNotes.push("checkpoint material cannot be used while the global readMaterial grant is revoked: " + entry.id);
        continue;
      }
      if (checkpoint.draftId !== null && material.draftId !== checkpoint.draftId) {
        materialNotes.push("checkpoint material is no longer associated with this draft: " + entry.id);
        continue;
      }
      if (entry.sectionIds !== undefined) {
        const currentSectionIds = new Set(material.sectionIds ?? []);
        const removedSectionIds = entry.sectionIds.filter((sid) => !currentSectionIds.has(sid));
        if (removedSectionIds.length > 0) {
          materialNotes.push("checkpoint material section association was removed: " + entry.id + " no longer linked to " + removedSectionIds.join(", "));
        }
      }
    }
    const draftBlocked = draft?.status === "withdrawn" || draft?.sentAt != null || draft?.status === "sent";
    const notes: string[] = [];
    if (staleSourceIds.length > 0) notes.push("sources changed since the checkpoint: " + staleSourceIds.join(", "));
    if (draftVersionMoved) notes.push("draft moved from checkpoint version " + checkpoint.draftVersion + " to " + (draft?.version ?? "none"));
    if (draftRevisionMoved) notes.push("draft revision moved from checkpoint revision " + checkpoint.draftRevision + " to " + (draft?.revision ?? "none"));
    if (confirmedMismatch) notes.push("previously confirmed sections no longer match the checkpoint");
    if (legacyMetadataIncomplete) notes.push("checkpoint predates revision/issue/association metadata; completeness cannot be proved and is reviewed conservatively");
    notes.push(...materialNotes);
    if (draft?.status === "withdrawn") {
      notes.push("draft was withdrawn after this checkpoint; resume stays report-only: the withdrawn draft is not reactivated, edited, or regenerated");
    } else if (draft?.sentAt != null || draft?.status === "sent") {
      notes.push("draft was already sent after this checkpoint; resume stays report-only: the sent draft is not reactivated, edited, or regenerated");
    }
    if (notes.length === 0) notes.push("checkpoint is current; resume is safe");
    const validation = {
      at: ctx.now,
      staleSourceIds,
      requiresReview:
        staleSourceIds.length > 0 || draftMoved || confirmedMismatch || legacyMetadataIncomplete || materialNotes.length > 0 || draftBlocked,
      notes,
    };
    const updated = { ...bump(checkpoint, ctx.now), resumeValidation: validation };
    const nextState = finish(
      state,
      { checkpoints: { ...state.checkpoints, [updated.id]: updated } },
      [{ entityId: updated.id, before: checkpoint.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "checkpoint.resumed",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: validation.requiresReview ? "resume requires review: " + notes.join("; ") : "resume validated cleanly",
      },
    );
    return ok(nextState, { checkpoint: updated, validation });
  },

  registerMaterial: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "registerMaterial" }>;
    const userFail = requireUser(c.actor, "registerMaterial");
    if (userFail) return userFail;
    if (typeof c.name !== "string" || !c.name.trim()) {
      return fail("INVALID_INPUT", "material needs a nonempty name", false);
    }
    if (!Number.isInteger(c.version) || c.version <= 0) {
      return fail("INVALID_INPUT", "material version must be a positive whole number", false);
    }
    if (c.readPermission !== "granted" && c.readPermission !== "denied") {
      return fail("INVALID_INPUT", "material readPermission must be granted or denied", false);
    }
    if (c.readPermission === "granted" && !state.ruleset.grants.readMaterial) {
      return fail(
        "INVALID_GRANT",
        "material read use is not allowed while the global readMaterial grant is revoked; explicit per-material consent does not override the global policy",
        false,
      );
    }
    const contentValue = typeof c.content === "string" && c.content.trim().length > 0 ? c.content : null;
    const accessRefValue = typeof c.accessRef === "string" && c.accessRef.trim().length > 0 ? c.accessRef : null;
    const hasContent = contentValue !== null;
    const hasAccessRef = accessRefValue !== null;
    if (!hasContent && !hasAccessRef) {
      return fail("INVALID_INPUT", "material needs actual local text (content) or an explicit reference (accessRef)", false);
    }
    if (!Array.isArray(c.sectionIds) || c.sectionIds.length === 0) {
      return fail("INVALID_INPUT", "material must be linked to at least one section", false);
    }
    if (new Set(c.sectionIds).size !== c.sectionIds.length) {
      return fail("INVALID_INPUT", "material sectionIds must not contain duplicates", false);
    }
    const draftLookup = lookupEntity(state.drafts, c.entityId, "draft");
    if (draftLookup.failure) return draftLookup.failure;
    const draft = draftLookup.entity;
    const revisionFail = requireRevision(draft.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (draft.sentAt) {
      return fail("INVALID_TRANSITION", "draft was already sent and can no longer accept materials", false);
    }
    if (draft.status === "withdrawn") {
      return fail("INVALID_TRANSITION", "draft was withdrawn and can no longer accept materials", false);
    }
    const knownSectionIds = new Set(draft.sections.map((s) => s.id));
    const unknownSectionIds = c.sectionIds.filter((id) => !knownSectionIds.has(id));
    if (unknownSectionIds.length > 0) {
      return fail(
        "INVALID_INPUT",
        "material sectionIds must reference real sections of this draft: " + unknownSectionIds.join(", "),
        false,
      );
    }
    const material: Material = {
      ...derivedBase(state, ctx),
      id: ctx.uuid(),
      name: c.name,
      accessRef: accessRefValue,
      version: c.version,
      verified: false,
      draftId: draft.id,
      sectionIds: [...c.sectionIds],
      readPermission: c.readPermission,
      content: contentValue,
    };
    if (c.readPermission === "denied") {
      const deniedState = finish(
        state,
        { materials: { ...state.materials, [material.id]: material } },
        [{ entityId: material.id, before: 0, after: 1 }],
        {
          eventId: ctx.uuid(),
          type: "material.registered",
          commandId: c.commandId,
          actor: c.actor,
          at: ctx.now,
          summary: "material registered as denied; metadata stored; not applied to any section",
        },
      );
      return ok(deniedState, { material, draft });
    }
    const sections = draft.sections.map((section) => {
      if (!c.sectionIds.includes(section.id)) return section;
      const wasConfirmed = section.reviewStatus === "confirmed";
      return {
        ...section,
        sourceRefs: [...section.sourceRefs, material.id],
        sourceVersions: { ...section.sourceVersions, [material.id]: material.version },
        contentVersion: section.contentVersion + 1,
        reviewStatus: "pendingReview" as const,
        confirmedBy: wasConfirmed ? null : section.confirmedBy,
        confirmedAt: wasConfirmed ? null : section.confirmedAt,
        confirmationInvalidReason: wasConfirmed
          ? "material added after confirmation: " + c.name
          : section.confirmationInvalidReason,
      };
    });
    const updated: Draft = {
      ...bump(draft, ctx.now),
      version: draft.version + 1,
      sections,
      sources: draft.sources.includes(material.id) ? draft.sources : [...draft.sources, material.id],
      status: draftStatusAfter(sections),
    };
    const nextState = finish(
      state,
      {
        materials: { ...state.materials, [material.id]: material },
        drafts: { ...state.drafts, [updated.id]: updated },
      },
      [
        { entityId: material.id, before: 0, after: 1 },
        { entityId: updated.id, before: draft.revision, after: updated.revision },
      ],
      {
        eventId: ctx.uuid(),
        type: "material.registered",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary: "material registered as granted; applied to " + c.sectionIds.length + " section(s); verification not claimed",
      },
    );
    return ok(nextState, { material, draft: updated });
  },

  withdrawDraft: (state, command, ctx) => {
    const c = command as Extract<Parameters<Handler>[1], { type: "withdrawDraft" }>;
    const userFail = requireUser(c.actor, "withdrawDraft");
    if (userFail) return userFail;
    if (c.reason !== undefined && typeof c.reason !== "string") {
      return fail("INVALID_INPUT", "withdrawDraft reason must be a string when provided", false);
    }
    const draftLookup = lookupEntity(state.drafts, c.entityId, "draft");
    if (draftLookup.failure) return draftLookup.failure;
    const draft = draftLookup.entity;
    const revisionFail = requireRevision(draft.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (draft.status === "withdrawn") {
      return ok(null, { draft });
    }
    if (draft.sentAt || draft.status === "sent") {
      return fail("INVALID_TRANSITION", "draft was already sent and local withdrawal cannot unsend it", false);
    }
    const updated: Draft = {
      ...bump(draft, ctx.now),
      version: draft.version + 1,
      status: "withdrawn",
      withdrawal: { withdrawnAt: ctx.now, reason: c.reason ?? null },
    };
    const nextState = finish(
      state,
      { drafts: { ...state.drafts, [updated.id]: updated } },
      [{ entityId: updated.id, before: draft.revision, after: updated.revision }],
      {
        eventId: ctx.uuid(),
        type: "draft.withdrawn",
        commandId: c.commandId,
        actor: c.actor,
        at: ctx.now,
        summary:
          "user withdrew the local draft; content, sources and history retained; approval stays consumed; operation and its resultRefs unchanged; nothing was sent and nothing external was undone",
      },
    );
    return ok(nextState, { draft: updated });
  },
};
