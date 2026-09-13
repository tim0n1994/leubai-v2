import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attentionWorkspaceHref } from "./attentionDraftLink.ts";
import { revealWorkspaceSection, workspaceSectionAnchor } from "../s06-workspace/section-anchor.ts";

test("only a resolved reference produces an exact encoded workspace and optional section link", () => {
  assert.equal(attentionWorkspaceHref({ ok: false, reason: "missing" }), null);
  const target = { ok: true as const, draftId: "draft & 1", operationId: "op/2", sectionId: "section #3", sectionTitle: "成本核对" };
  const url = new URL(attentionWorkspaceHref(target)!, "https://local.invalid");
  assert.equal(url.pathname, "/workspace");
  assert.equal(url.searchParams.get("draftId"), target.draftId);
  assert.equal(url.searchParams.get("operationId"), target.operationId);
  assert.equal(decodeURIComponent(url.hash.slice(1)), workspaceSectionAnchor(target.sectionId));
  assert.equal(new URL(attentionWorkspaceHref({ ...target, sectionId: null })!, url.origin).hash, "");
});

test("mounted section focuses and scrolls only its exact valid hash, including after async arrival", () => {
  let focus = 0;
  let scroll = 0;
  const node = { id: workspaceSectionAnchor("section #3"), focus: () => { focus += 1; }, scrollIntoView: () => { scroll += 1; } } as unknown as HTMLElement;
  revealWorkspaceSection(null, "#anything");
  revealWorkspaceSection(node, "#other");
  revealWorkspaceSection(node, "#%malformed");
  assert.equal(focus, 0);
  revealWorkspaceSection(node, "#" + encodeURIComponent(node.id));
  assert.equal(focus, 1);
  assert.equal(scroll, 1);
});

test("judgment, queued and silent rows expose real draft links and both workspace states use stable anchors", () => {
  const screen = readFileSync(new URL("./AttentionScreen.tsx", import.meta.url), "utf8");
  assert.equal(screen.match(/<AttentionDraftAction item=\{item\} state=\{props.state\} \/>/g)?.length, 3);
  assert.match(screen, /查看差异/);
  assert.doesNotMatch(screen, /查看详情不占用提醒预算。该条目没有关联/);
  const workspace = readFileSync(new URL("../s06-workspace/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.equal(workspace.match(/ref=\{revealWorkspaceSection\}/g)?.length, 2);
  assert.equal(workspace.match(/id=\{workspaceSectionAnchor\(section.id\)\}/g)?.length, 2);
});
