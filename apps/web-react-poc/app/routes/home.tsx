import { HomePage } from "../../src/features/home/home-page";

export function meta() {
  return [{ title: "Андромеда × МГТУ имени Баумана — выбор направления" }, { name: "description", content: "Подбор образовательных программ по интересам, сравнение учебных планов и опубликованные условия поступления МГТУ." }];
}

export default function HomeRoute() {
  return <HomePage />;
}
