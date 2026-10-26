import { NotFoundPage } from "@/shared/ui/not-found-page";

export function meta() {
  return [{ title: "Страница не найдена — Андромеда" }];
}

export default function NotFoundRoute() {
  return <NotFoundPage />;
}
