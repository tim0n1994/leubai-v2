import { useEffect, useState } from "react";
import { MobileChrome } from "../screens/mobile/MobileChrome";
import { SettingsPage } from "./SettingsPage";

function currentClock(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return pad(now.getHours()) + ":" + pad(now.getMinutes());
}

export function MobileSettingsPage() {
  const [time, setTime] = useState(currentClock);

  useEffect(() => {
    const id = window.setInterval(() => setTime(currentClock()), 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div data-page="m-settings">
      <MobileChrome time={time} active="settings">
        <SettingsPage embedded />
      </MobileChrome>
    </div>
  );
}
