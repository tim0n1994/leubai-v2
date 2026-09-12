import type { RouteGroup } from "./types";
import { S01Now } from "../screens/s01-now/S01Now";
import { S02Ledger } from "../screens/s02-ledger/S02Ledger";
import { S03Inbox } from "../screens/s03-inbox/S03Inbox";
import { S04Plan } from "../screens/s04-plan/S04Plan";

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
    { path: "/ledger", element: <S02Ledger /> },
    { path: "/inbox", element: <S03Inbox /> },
    { path: "/plan", element: <S04Plan /> },
    { path: "/preview", element: <ScreenStub id="s05" title="变更预览 · 有限授权" /> },
  ],
  bare: [],
};
