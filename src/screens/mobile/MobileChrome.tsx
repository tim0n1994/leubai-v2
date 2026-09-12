import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { BatteryFull, Wifi } from "lucide-react";
import "./mobile-chrome.css";

const TABS = [
  { to: "/m/now", label: "此刻", key: "now" },
  { to: "/ledger", label: "时间", key: "ledger" },
  { to: "/m/plan", label: "协同", key: "plan" },
  { to: "/m/auth", label: "我的", key: "auth" },
];

export function MobileChrome({
  time,
  active,
  children,
}: {
  time: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <div className="mchrome">
      <div className="mchrome-status">
        <span className="mchrome-time">{time}</span>
        <span className="mchrome-sig">
          <Wifi size={14} aria-hidden="true" />
          <BatteryFull size={18} aria-hidden="true" />
        </span>
      </div>
      <div className="mchrome-body">{children}</div>
      <nav className="mchrome-tabbar" aria-label="移动端导航">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={
              tab.key === active ? "mchrome-tab is-active" : "mchrome-tab"
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
