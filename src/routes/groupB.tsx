import type { RouteGroup } from "./types";

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
    { path: "/workspace", element: <ScreenStub id="s06" title="协同工作台 · 有来源的草稿" /> },
    { path: "/session", element: <ScreenStub id="s07" title="工作现场 · 恢复下一步" /> },
    { path: "/blank", element: <ScreenStub id="s08" title="留白时刻 · 不安排也成立" /> },
    { path: "/attention", element: <ScreenStub id="s09" title="注意力队列 · 同一份预算" /> },
    { path: "/boundaries", element: <ScreenStub id="s10" title="我的边界 · 权限与暂停" /> },
  ],
  bare: [],
};
