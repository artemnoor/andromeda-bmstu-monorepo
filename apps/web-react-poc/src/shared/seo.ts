import type { MetaDescriptor } from "react-router";

export const SITE_ORIGIN = "https://andromedabmstu.ru";

export const SEO_PAGES = {
  "/": {
    title: "Андромеда — выбор и сравнение направлений МГТУ",
    description: "Андромеда помогает выбрать направление в МГТУ им. Н. Э. Баумана: профориентационный тест, сравнение направлений и программ, учебных планов и условий поступления.",
    name: "Андромеда",
  },
  "/programs": {
    title: "Программы МГТУ им. Баумана: каталог направлений — Андромеда",
    description: "Каталог программ бакалавриата и специалитета МГТУ им. Н. Э. Баумана. Поиск по кафедре и направлению, учебные планы и опубликованные условия поступления.",
    name: "Каталог программ",
  },
  "/discover": {
    title: "Профориентационный тест для выбора направления — Андромеда",
    description: "Пройди профориентационный тест и подбери образовательные программы МГТУ им. Н. Э. Баумана по своим интересам. Рекомендации с объяснением и сравнением программ.",
    name: "Профориентационный тест",
  },
  "/compare": {
    title: "Сравнение направлений и программ МГТУ — Андромеда",
    description: "Сравнение направлений и образовательных программ МГТУ им. Н. Э. Баумана в Андромеде: учебные планы, предметы, нагрузка и условия поступления. До трёх программ рядом.",
    name: "Сравнение программ",
  },
  "/feedback": {
    title: "Обратная связь — Андромеда",
    description: "Свяжись с командой Андромеды в Telegram или ВКонтакте: задай вопрос, предложи улучшение или сообщи о неточности в образовательной программе.",
    name: "Обратная связь",
  },
} as const;

type SeoPath = keyof typeof SEO_PAGES;

export function indexingPolicy(path: string, search = ""): string {
  const parameters = new URLSearchParams(search);
  const privateOrFiltered = ["q", "code", "direction", "department", "result", "program", "programs", "shared"].some((key) => parameters.has(key));
  return (!(path in SEO_PAGES) && !/^\/programs\/[\w.-]+$/.test(path)) || privateOrFiltered ? "noindex, follow" : "index, follow, max-image-preview:large";
}

/** Keep metadata identical in the initial HTML and after client navigation. */
export function pageMeta(path: SeoPath): MetaDescriptor[] {
  const page = SEO_PAGES[path];
  const url = SITE_ORIGIN + (path === "/" ? "/" : path);
  return [
    { title: page.title },
    { name: "description", content: page.description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "ru_RU" },
    { property: "og:site_name", content: "Андромеда" },
    { property: "og:title", content: page.title },
    { property: "og:description", content: page.description },
    { property: "og:url", content: url },
    { property: "og:image", content: `${SITE_ORIGIN}/social-preview.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Андромеда — навигатор образовательных программ МГТУ им. Н. Э. Баумана" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: page.title },
    { name: "twitter:description", content: page.description },
    { name: "twitter:image", content: `${SITE_ORIGIN}/social-preview.png` },
    { "script:ld+json": {
      "@context": "https://schema.org",
      "@graph": [
        ...(path === "/" ? [
          { "@type": "Organization", "@id": `${SITE_ORIGIN}/#organization`, name: "Андромеда", url: SITE_ORIGIN + "/", logo: `${SITE_ORIGIN}/android-chrome-512x512.png`, sameAs: ["https://t.me/proximart", "https://vk.ru/club236804216"] },
          { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, url: SITE_ORIGIN + "/", name: "Андромеда", alternateName: "Andromeda", inLanguage: "ru", publisher: { "@id": `${SITE_ORIGIN}/#organization` } },
        ] : []),
        { "@type": "WebPage", "@id": url + "#webpage", url, name: page.title, description: page.description, inLanguage: "ru", isPartOf: { "@id": `${SITE_ORIGIN}/#website` } },
        ...(path !== "/" ? [{ "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Андромеда", item: SITE_ORIGIN + "/" },
          { "@type": "ListItem", position: 2, name: page.name, item: url },
        ] }] : []),
      ],
    } },
  ];
}
