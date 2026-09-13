import type { ChangeSet } from "./types.ts";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function fnv1a32(input: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV-1a 32-bit prime
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function bindingHash(parts: Record<string, unknown>): string {
  return "h1-" + fnv1a32(canonicalJson(parts));
}

export function computeChangeSetHash(cs: ChangeSet): string {
  return bindingHash({
    planId: cs.planId,
    planRevision: cs.planRevision,
    label: cs.label,
    actions: cs.actions,
    objectDiffs: cs.objectDiffs,
    requiredGrants: cs.requiredGrants,
    exclusions: cs.exclusions,
    targetRevisions: cs.targetRevisions,
    sourceVersionSet: cs.sourceVersionSet,
    ruleRevision: cs.ruleRevision,
  });
}
