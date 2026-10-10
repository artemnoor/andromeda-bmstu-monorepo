import { index, route } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("programs", "routes/programs.tsx"),
  route("compare", "routes/compare.tsx"),
] satisfies RouteConfig;
