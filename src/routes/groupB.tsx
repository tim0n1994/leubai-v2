import type { RouteGroup } from "./types";
import { WorkspaceScreen } from "../screens/s06-workspace/WorkspaceScreen";
import { SessionScreen } from "../screens/s07-session/SessionScreen";

function ScreenStub({ id, title }: { id: string; title: string }) {
  return (
    <section className="stub" data-page={id}>
      <h1 className="stub-title">{title}</h1>
      <p className="stub-note">该屏幕按设计稿实现中。</p>
    </section>
  );
}

export const groupB: RouteGroup = {
  shell: [
    { path: "/workspace", element: <WorkspaceScreen /> },
    { path: "/session", element: <SessionScreen /> },
    { path: "/blank", element: <ScreenStub id="s08" title="留白时刻 · 不安排也成立" /> },
    { path: "/attention", element: <ScreenStub id="s09" title="注意力队列 · 同一份预算" /> },
    { path: "/boundaries", element: <ScreenStub id="s10" title="我的边界 · 权限与暂停" /> },
  ],
  bare: [],
};
