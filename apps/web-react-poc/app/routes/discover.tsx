import { ProfTestPage } from "../../src/features/prof-test/prof-test-page";
import { pageMeta } from "@/shared/seo";

export function meta() {
  return pageMeta("/discover");
}

export default function DiscoverRoute() {
  return <ProfTestPage />;
}
