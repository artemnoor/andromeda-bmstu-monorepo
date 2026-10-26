import { HomePage } from "../../src/features/home/home-page";
import { pageMeta } from "@/shared/seo";

export function meta() {
  return pageMeta("/");
}

export default function HomeRoute() {
  return <HomePage />;
}
