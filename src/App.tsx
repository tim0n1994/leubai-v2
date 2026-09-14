import { lazy, useEffect } from "react";
import { Outlet, useRoutes } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { groupA } from "./routes/groupA";
import { groupB } from "./routes/groupB";
import { groupC } from "./routes/groupC";
import { suspended } from "./routes/suspended";
import { getDomainRuntime } from "./runtime/index.ts";
import { startAttentionDueRuntime } from "./runtime/attentionDue.ts";

const SettingsPage = lazy(() => import("./settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const MobileSettingsPage = lazy(() => import("./settings/MobileSettingsPage").then((m) => ({ default: m.MobileSettingsPage })));

function AttentionDueRuntimeBridge() {
  useEffect(() => {
    let stopped: (() => void) | null = null;
    let active = true;
    void getDomainRuntime().then((handle) => {
      if (active && handle.status === "ready") stopped = startAttentionDueRuntime(handle);
    });
    return () => {
      active = false;
      stopped?.();
    };
  }, []);
  return null;
}

export default function App() {
  const routes = useRoutes([
    {
      element: (
        <Shell>
          <Outlet />
        </Shell>
      ),
      children: [...groupA.shell, ...groupB.shell, ...groupC.shell, { path: "/settings", element: suspended(SettingsPage) }],
    },
    ...groupA.bare,
    ...groupB.bare,
    ...groupC.bare,
    { path: "/m/settings", element: suspended(MobileSettingsPage) },
  ]);
  return (
    <>
      <AttentionDueRuntimeBridge />
      {routes}
    </>
  );
}
