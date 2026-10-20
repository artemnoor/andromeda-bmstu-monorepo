import {
  AiIdeaIcon,
  AiSparklesIcon,
  ArrowRight01Icon,
  BookOpen02Icon,
  BookOpenCheckIcon,
  ChartAverageIcon,
  DocumentValidationIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import styles from "./learning-overview-accordion.module.css";

const topics = [
  {
    value: "study-plan",
    number: "01",
    title: "Ты ещё в поиске себя",
    intro:
      "Начни с профтеста: ответы помогут подобрать направления, которые стоит изучить внимательнее.",
    sectionTitle: "От интересов — к направлениям",
    details: [
      {
        title: "Пройди профтест",
        description:
          "Расскажи о том, что тебе интересно и какие задачи хотелось бы решать.",
        icon: AiIdeaIcon,
      },
      {
        title: "Получи рекомендации",
        description:
          "Посмотри, какие направления подходят под твои интересы и ответы.",
        icon: AiSparklesIcon,
      },
      {
        title: "Изучи программы",
        description:
          "Открой каталог и узнай, чему учат на рекомендованных направлениях.",
        icon: BookOpen02Icon,
      },
    ],
    actions: [
      { label: "Пройти профтест", to: "/discover", primary: true },
      { label: "Открыть каталог", to: "/programs", primary: false },
    ],
  },
  {
    value: "subject-areas",
    number: "02",
    title: "Ты уже определился",
    intro:
      "Добавь интересующие направления в сравнение и оцени учебные планы и условия поступления рядом.",
    sectionTitle: "Сравни важное в одном месте",
    details: [
      {
        title: "Учебные планы",
        description:
          "Сопоставь дисциплины и предметные области выбранных программ.",
        icon: BookOpenCheckIcon,
      },
      {
        title: "Нагрузка и часы",
        description:
          "Посмотри, как опубликованные часы распределяются по категориям.",
        icon: ChartAverageIcon,
      },
      {
        title: "Условия поступления",
        description:
          "Сопоставь доступные места, баллы и требования с указанием года и источника.",
        icon: DocumentValidationIcon,
      },
    ],
    actions: [
      { label: "Сравнить направления", to: "/compare", primary: true },
      { label: "Открыть каталог", to: "/programs", primary: false },
    ],
  },
];

export function LearningOverviewAccordion() {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue="study-plan"
      className={styles.accordion}
    >
      {topics.map((topic) => (
        <AccordionItem
          key={topic.value}
          value={topic.value}
          className={
            topic.value === "study-plan"
              ? styles.bottomSpacedItem
              : styles.spaciousItem
          }
        >
          <AccordionTrigger className={styles.trigger}>
            <span className={styles.headingGroup}>
              <span className={styles.headingNumber}>{topic.number}</span>
              <span className={styles.headingText}>{topic.title}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={styles.panelIntro}>{topic.intro}</div>
            <section className={styles.learningSection}>
              <h3 className={styles.sectionTitle}>{topic.sectionTitle}</h3>
              <div className={styles.detailStack}>
                {topic.details.map((detail) => (
                  <article className={styles.detailSection} key={detail.title}>
                    <span className={styles.detailIcon} aria-hidden="true">
                      <HugeiconsIcon
                        icon={detail.icon}
                        size={40}
                        strokeWidth={1.5}
                      />
                    </span>
                    <h4 className={styles.detailTitle}>{detail.title}</h4>
                    <p className={styles.sectionDescription}>
                      {detail.description}
                    </p>
                  </article>
                ))}
              </div>
            </section>
            <div className={styles.topicActions}>
              {topic.actions.map((action) => (
                <Link
                  className={`${styles.actionButton} ${
                    action.primary ? styles.actionPrimary : styles.actionSecondary
                  }`}
                  key={action.to}
                  to={action.to}
                >
                  {action.label}
                  <span className={styles.actionIcon} aria-hidden="true">
                    <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
                  </span>
                </Link>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
