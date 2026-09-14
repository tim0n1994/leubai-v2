import { lazy } from "react";
import type { RouteGroup } from "./types";
import { suspended } from "./suspended";

const S01Now = lazy(() => import("../screens/s01-now/S01Now").then((m) => ({ default: m.S01Now })));
const S02Ledger = lazy(() => import("../screens/s02-ledger/S02Ledger").then((m) => ({ default: m.S02Ledger })));
const S03Inbox = lazy(() => import("../screens/s03-inbox/S03Inbox").then((m) => ({ default: m.S03Inbox })));
const S04Plan = lazy(() => import("../screens/s04-plan/S04Plan").then((m) => ({ default: m.S04Plan })));
const S05Preview = lazy(() => import("../screens/s05-preview/S05Preview").then((m) => ({ default: m.S05Preview })));

export const groupA: RouteGroup = {
  shell: [
    { path: "/", element: suspended(S01Now) },
    { path: "/ledger", element: suspended(S02Ledger) },
    { path: "/inbox", element: suspended(S03Inbox) },
    { path: "/plan", element: suspended(S04Plan) },
    { path: "/preview", element: suspended(S05Preview) },
  ],
  bare: [],
};
