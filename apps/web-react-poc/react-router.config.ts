import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  buildDirectory: process.env.ANDROMEDA_REACT_PROFILE_BUILD === "1" ? "build-profile" : "build",
  ssr: false,
} satisfies Config;
