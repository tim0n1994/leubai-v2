import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { proposalSummaryLabel } from "./proposal-summary-label.ts";

test("unconsumed proposal keeps pending-approval wording including omitted prop", () => {
  assert.equal(proposalSummaryLabel(), "待批准的实际变更");
  assert.equal(proposalSummaryLabel(false), "待批准的实际变更");
});

test("consumed proposal uses matching heading and accessible label", () => {
  assert.equal(proposalSummaryLabel(true), "本次授权对应变更");
  const component = readFileSync(new URL("./ProposalSummary.tsx", import.meta.url), "utf8");
  assert.match(component, /used = false/);
  assert.match(component, /const label = proposalSummaryLabel\(used\)/);
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /方案 \{proposal\.plan\.kind\} · \{label\}/);
  const screen = readFileSync(new URL("../s17-m-auth/S17MAuth.tsx", import.meta.url), "utf8");
  assert.match(screen, /<ProposalSummary proposal=\{proposal\} used=\{used\} \/>/);
});
