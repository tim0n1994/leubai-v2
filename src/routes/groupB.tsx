import { lazy } from "react";
import type { RouteGroup } from "./types";
import { suspended } from "./suspended";

const WorkspaceScreen = lazy(() => import("../screens/s06-workspace/WorkspaceScreen").then((m) => ({ default: m.WorkspaceScreen })));
const SessionScreen = lazy(() => import("../screens/s07-session/SessionScreen").then((m) => ({ default: m.SessionScreen })));
const BlankScreen = lazy(() => import("../screens/s08-blank/BlankScreen").then((m) => ({ default: m.BlankScreen })));
const AttentionScreen = lazy(() => import("../screens/s09-attention/AttentionScreen").then((m) => ({ default: m.AttentionScreen })));
const BoundariesScreen = lazy(() => import("../screens/s10-boundaries/BoundariesScreen").then((m) => ({ default: m.BoundariesScreen })));

export const groupB: RouteGroup = {
  shell: [
    { path: "/workspace", element: suspended(WorkspaceScreen) },
    { path: "/session", element: suspended(SessionScreen) },
    { path: "/attention", element: suspended(AttentionScreen) },
    { path: "/boundaries", element: suspended(BoundariesScreen) },
  ],
  bare: [{ path: "/blank", element: suspended(BlankScreen) }],
};
