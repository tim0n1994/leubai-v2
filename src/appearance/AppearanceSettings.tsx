import { useSyncExternalStore } from "react";
import { getAppearanceStore } from "./browser.ts";
import type { AppearanceStatus, AppearanceTheme } from "./theme.ts";
import "./appearance.css";

const OPTIONS: ReadonlyArray<{ value: AppearanceTheme; label: string }> = [
  { value: "porcelain", label: "默认·瓷白" },
  { value: "ink", label: "水墨" },
];

const ISSUE_MESSAGES: Record<Exclude<AppearanceStatus["issue"], null>, string> = {
  corrupted: "已保存的外观设置无法识别，已恢复默认·瓷白。",
  "read-failed": "无法读取已保存的外观设置，当前使用默认·瓷白。",
  "write-failed": "保存失败：本次选择仅在当前页面生效，刷新后将恢复原设置。",
};

export function AppearanceSettings() {
  const store = getAppearanceStore();
  const status = useSyncExternalStore(store.subscribe, store.getStatus);
  return (
    <section className="appearance-settings" data-appearance-settings>
      <h3 className="appearance-heading">外观</h3>
      <div className="appearance-options" role="radiogroup" aria-label="外观">
        {OPTIONS.map((option) => {
          const selected = status.theme === option.value;
          return (
            <label
              key={option.value}
              className={selected ? "appearance-option is-selected" : "appearance-option"}
              data-appearance-option={option.value}
            >
              <input
                className="appearance-input"
                type="radio"
                name="appearance-theme"
                value={option.value}
                checked={selected}
                onChange={() => store.setTheme(option.value)}
              />
              <span className="appearance-option-body">
                <span className="appearance-option-label">{option.label}</span>
                {selected ? (
                  <span className="appearance-check" data-appearance-check>
                    <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10">
                      <path d="M2.2 6.4 5 9.2 9.8 2.8" />
                    </svg>
                    已选择
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <p className="appearance-status" data-appearance-status role="status">
        {status.issue === null ? "" : ISSUE_MESSAGES[status.issue]}
      </p>
    </section>
  );
}
