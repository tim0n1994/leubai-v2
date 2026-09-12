import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./shell.css";

const NAV_ITEMS = [
  { to: "/", label: "此刻" },
  { to: "/ledger", label: "时间" },
  { to: "/inbox", label: "收件" },
  { to: "/workspace", label: "协同" },
  { to: "/review", label: "回顾" },
  { to: "/boundaries", label: "边界" },
];

const PAGE_NUMBERS: Record<string, string> = {
  "/": "01",
  "/ledger": "02",
  "/inbox": "03",
  "/plan": "04",
  "/preview": "05",
  "/workspace": "06",
  "/session": "07",
  "/blank": "08",
  "/attention": "09",
  "/boundaries": "10",
  "/context": "11",
  "/review": "12",
  "/sync": "13",
  "/capture": "14",
};

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const pageNumber = PAGE_NUMBERS[pathname] ?? "01";
  return (
    <div className="shell" data-shell="">
      <aside className="shell-rail">
        <div className="shell-brand">
          <span className="shell-brand-zh">留白</span>
          <span className="shell-brand-en">PERSONAL TIME</span>
        </div>
        <nav className="shell-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "shell-nav-item is-active" : "shell-nav-item"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <span className="shell-topbar-title">留白 · Personal Time</span>
          <span className="shell-badge">概念设计 · 演示状态</span>
          <span className="shell-date">09.12 · 星期六</span>
        </header>
        <main className="shell-content">{children}</main>
        <footer className="shell-footer">
          <span>页面 {pageNumber} / 18</span>
          <span>界面为独立演示状态；不代表已连接、已执行或真实收益。</span>
        </footer>
      </div>
    </div>
  );
}

export function MobileStage({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-stage">
      <div className="mobile-frame">{children}</div>
    </div>
  );
}
