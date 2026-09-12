import type { RouteGroup } from "./types";

function ScreenStub({ id, title }: { id: string; title: string }) {
  return (
    <section className="stub" data-page={id}>
      <h1 className="stub-title">{title}</h1>
      <p className="stub-note">该屏幕按设计稿实现中。</p>
    </section>
  );
}

function MobileStub({ id, title }: { id: string; title: string }) {
  return (
    <section className="stub" data-page={id}>
      <h1 className="stub-title">{title}</h1>
      <p className="stub-note">该屏幕按设计稿实现中。</p>
    </section>
  );
}

export const groupC: RouteGroup = {
  shell: [
    { path: "/context", element: <ScreenStub id="s11" title="私人上下文 · 来源与推测" /> },
    { path: "/review", element: <ScreenStub id="s12" title="时间回顾 · 收益不做假账" /> },
    { path: "/sync", element: <ScreenStub id="s13" title="同步异常 · 未知与接管" /> },
    { path: "/capture", element: <ScreenStub id="s14" title="快捷输入 · 意图与约束" /> },
  ],
  bare: [
    { path: "/m/now", element: <MobileStub id="s15" title="移动端 · 此刻" /> },
    { path: "/m/plan", element: <MobileStub id="s16" title="移动端 · 自适应方案" /> },
    { path: "/m/auth", element: <MobileStub id="s17" title="移动端 · 一次性授权" /> },
    { path: "/m/blank", element: <MobileStub id="s18" title="移动端 · 留白时刻" /> },
  ],
};
