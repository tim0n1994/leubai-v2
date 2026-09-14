import { lazy } from "react";
import { MobileStage } from "../shell/Shell";
import type { RouteGroup } from "./types";
import { suspended } from "./suspended";

const S11Context = lazy(() => import("../screens/s11-context/S11Context").then((m) => ({ default: m.S11Context })));
const S12Review = lazy(() => import("../screens/s12-review/S12Review").then((m) => ({ default: m.S12Review })));
const S13Sync = lazy(() => import("../screens/s13-sync/S13Sync").then((m) => ({ default: m.S13Sync })));
const S14Capture = lazy(() => import("../screens/s14-capture/S14Capture").then((m) => ({ default: m.S14Capture })));
const S15MNow = lazy(() => import("../screens/s15-m-now/S15MNow").then((m) => ({ default: m.S15MNow })));
const S16MPlan = lazy(() => import("../screens/s16-m-plan/S16MPlan").then((m) => ({ default: m.S16MPlan })));
const S17MAuth = lazy(() => import("../screens/s17-m-auth/S17MAuth").then((m) => ({ default: m.S17MAuth })));
const S18MBlank = lazy(() => import("../screens/s18-m-blank/S18MBlank").then((m) => ({ default: m.S18MBlank })));

export const groupC: RouteGroup = {
  shell: [
    { path: "/context", element: suspended(S11Context) },
    { path: "/review", element: suspended(S12Review) },
    { path: "/sync", element: suspended(S13Sync) },
    { path: "/capture", element: suspended(S14Capture) },
  ],
  bare: [
    {
      path: "/m/now",
      element: (
        <MobileStage>
          {suspended(S15MNow)}
        </MobileStage>
      ),
    },
    {
      path: "/m/plan",
      element: (
        <MobileStage>
          {suspended(S16MPlan)}
        </MobileStage>
      ),
    },
    {
      path: "/m/auth",
      element: (
        <MobileStage>
          {suspended(S17MAuth)}
        </MobileStage>
      ),
    },
    {
      path: "/m/blank",
      element: (
        <MobileStage>
          {suspended(S18MBlank)}
        </MobileStage>
      ),
    },
  ],
};
