import { index, route } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("discover", "routes/discover.tsx"),
  route("programs", "routes/programs.tsx"),
  route("programs/:slug", "routes/program-detail.tsx"),
  route("compare", "routes/compare.tsx"),
  route("feedback", "routes/feedback.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
