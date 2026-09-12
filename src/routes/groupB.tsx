import type { RouteGroup } from "./types";
import { WorkspaceScreen } from "../screens/s06-workspace/WorkspaceScreen";
import { SessionScreen } from "../screens/s07-session/SessionScreen";
import { BlankScreen } from "../screens/s08-blank/BlankScreen";
import { AttentionScreen } from "../screens/s09-attention/AttentionScreen";
import { BoundariesScreen } from "../screens/s10-boundaries/BoundariesScreen";

export const groupB: RouteGroup = {
  shell: [
    { path: "/workspace", element: <WorkspaceScreen /> },
    { path: "/session", element: <SessionScreen /> },
    { path: "/blank", element: <BlankScreen /> },
    { path: "/attention", element: <AttentionScreen /> },
    { path: "/boundaries", element: <BoundariesScreen /> },
  ],
  bare: [],
};
