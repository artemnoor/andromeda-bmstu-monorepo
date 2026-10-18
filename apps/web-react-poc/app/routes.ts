import { index, route } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("discover", "routes/discover.tsx"),
  route("programs", "routes/programs.tsx"),
  route("compare", "routes/compare.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
