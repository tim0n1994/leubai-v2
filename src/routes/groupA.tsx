import type { RouteGroup } from "./types";
import { S01Now } from "../screens/s01-now/S01Now";

function ScreenStub({ id, title }: { id: string; title: string }) {
  return (
    <section className="stub" data-page={id}>
      <h1 className="stub-title">{title}</h1>
      <p className="stub-note">该屏幕按设计稿实现中。</p>
    </section>
  );
}

export const groupA: RouteGroup = {
  shell: [
    { path: "/", element: <S01Now /> },
    { path: "/ledger", element: <ScreenStub id="s02" title="时间账本 · 责任与边界" /> },
    { path: "/inbox", element: <ScreenStub id="s03" title="收件箱 · 请求不等于承诺" /> },
    { path: "/plan", element: <ScreenStub id="s04" title="自适应方案 · 改变方法与分工" /> },
    { path: "/preview", element: <ScreenStub id="s05" title="变更预览 · 有限授权" /> },
  ],
  bare: [],
};
