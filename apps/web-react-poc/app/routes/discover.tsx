import { ProfTestPage } from "../../src/features/prof-test/prof-test-page";

export function meta() {
  return [
    { title: "Проф-тест — Andromeda × BMSTU" },
    { name: "description", content: "Подбери образовательные программы МГТУ по своим интересам и проверенным учебным планам." },
  ];
}

export default function DiscoverRoute() {
  return <ProfTestPage />;
}
