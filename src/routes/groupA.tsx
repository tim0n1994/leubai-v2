import type { RouteGroup } from "./types";
import { S01Now } from "../screens/s01-now/S01Now";
import { S02Ledger } from "../screens/s02-ledger/S02Ledger";
import { S03Inbox } from "../screens/s03-inbox/S03Inbox";
import { S04Plan } from "../screens/s04-plan/S04Plan";
import { S05Preview } from "../screens/s05-preview/S05Preview";

export const groupA: RouteGroup = {
  shell: [
    { path: "/", element: <S01Now /> },
    { path: "/ledger", element: <S02Ledger /> },
    { path: "/inbox", element: <S03Inbox /> },
    { path: "/plan", element: <S04Plan /> },
    { path: "/preview", element: <S05Preview /> },
  ],
  bare: [],
};
