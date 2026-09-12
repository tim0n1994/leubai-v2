import { Outlet, useRoutes } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { groupA } from "./routes/groupA";
import { groupB } from "./routes/groupB";
import { groupC } from "./routes/groupC";

export default function App() {
  return useRoutes([
    {
      element: (
        <Shell>
          <Outlet />
        </Shell>
      ),
      children: [...groupA.shell, ...groupB.shell, ...groupC.shell],
    },
    ...groupA.bare,
    ...groupB.bare,
    ...groupC.bare,
  ]);
}
