import type { RouteObject } from "react-router-dom";

export type RouteGroup = {
  shell: RouteObject[];
  bare: RouteObject[];
};
