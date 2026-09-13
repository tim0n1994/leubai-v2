export function workspaceSectionAnchor(sectionId: string): string { return "s06-section-" + sectionId; }
export function revealWorkspaceSection(element: HTMLElement | null, hash?: string): void {
  if (element === null) return;
  const currentHash = hash ?? (typeof window === "undefined" ? "" : window.location.hash);
  let target: string;
  try { target = decodeURIComponent(currentHash.slice(1)); } catch { return; }
  if (!currentHash.startsWith("#") || target !== element.id) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "center", behavior: "auto" });
}
