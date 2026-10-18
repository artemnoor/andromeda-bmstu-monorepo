import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  AcademicApiContractError,
  AcademicApiError,
  AcademicReleaseMismatchError,
} from "@/shared/api/client";
import { useComparisonSelection, comparisonSelection } from "@/shared/browser-state/hooks";
import {
  APPLICANT_PROFILE_KEY,
  LEGACY_APPLICANT_PROFILE_KEY,
  readApplicantScores,
} from "@/shared/browser-state/storage";
import { formatCount, russianPlural, safeExternalUrl } from "@/features/catalog/model";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { loadProfTestAdmissionStatus, loadProfTestData, type ProfTestAdmissionStatus } from "./api";
import { profTestLog } from "./logger";
import {
  ACTIVITY_OPTIONS,
  MAX_AVOID,
  MAX_COMPARISONS,
  MAX_INTERESTS,
  NO_ACTIVITY,
  NO_AVOID,
  PAIR_CHOICES,
  UNKNOWN_INTEREST,
  admissionScoreStatus,
  emptyAnswers,
  normalizedCategoryShare,
  preferenceWeights,
  rankPrograms,
  selectAdaptivePair,
  shouldFinishAfterComparison,
  type CareerTestAnswers,
  type SubjectCategory,
} from "./model";
import type { ProfTestData, ProfTestLoadProgress } from "./api";
import { readProfTestSession, saveProfTestSession, type FlowSnapshot, type FlowState } from "./session";
import styles from "./prof-test.module.css";
import { categoryPresentation } from "./presentation";
import { ProgramResults } from "./program-results";

type LoadState =
  | { readonly status: "loading"; readonly progress: ProfTestLoadProgress }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: ProfTestData };

type AdmissionState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly data: ProfTestAdmissionStatus };

const INITIAL_PROGRESS: ProfTestLoadProgress = {
  label: "Сверяем каталог и классификации активного выпуска",
  completed: 0,
  total: 0,
};

function initialFlow(): FlowState {
  return {
    phase: "interests",
    answers: emptyAnswers(),
    currentPair: null,
    draftComparison: null,
    history: [],
  };
}

function snapshot(flow: FlowState): FlowSnapshot {
  return {
    phase: flow.phase,
    answers: flow.answers,
    currentPair: flow.currentPair,
    draftComparison: flow.draftComparison,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof AcademicReleaseMismatchError) {
    return "Во время загрузки сменился активный академический выпуск. Перезагрузите страницу, чтобы собрать тест из одного выпуска.";
  }
  if (error instanceof AcademicApiError && error.code === "request_timeout") {
    return "Сервис академических данных не ответил вовремя. Попробуйте загрузить тест ещё раз.";
  }
  if (error instanceof AcademicApiError && error.code === "network_error") {
    return "Не удалось подключиться к сервису академических данных. Проверьте подключение и повторите попытку.";
  }
  if (error instanceof AcademicApiContractError) {
    return "Не удалось безопасно собрать данные для теста. Проверьте доступность и согласованность учебных планов.";
  }
  return "Не удалось загрузить учебные планы. Попробуйте ещё раз.";
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value * 100)}%`;
}

function phaseNumber(flow: FlowState): number {
  if (flow.phase === "interests") return 1;
  if (flow.phase === "activity") return 2;
  if (flow.phase === "avoid") return 3;
  return Math.min(7, 4 + flow.answers.comparisons.length);
}

function activeProfileSource(profile: ProfTestData): string {
  const key = profile.releaseKey;
  return key.length > 32 ? `${key.slice(0, 16)}…${key.slice(-8)}` : key;
}

function questionActionLabel(flow: FlowState, data: ProfTestData): string {
  if (flow.phase !== "compare" || flow.draftComparison === null || !flow.currentPair) return "Продолжить";
  return shouldFinishAfterComparison(
    data.profiles,
    flow.answers,
    flow.currentPair,
    flow.draftComparison,
  ) ? "Показать результат" : "Продолжить";
}

export function ProfTestPage() {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading", progress: INITIAL_PROGRESS });
  const [flow, setFlow] = useState(initialFlow);
  const [applicantScores, setApplicantScores] = useState(readApplicantScores);
  const [feedback, setFeedback] = useState("");
  const [comparisonFeedback, setComparisonFeedback] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [admissionResult, setAdmissionResult] = useState<{
    readonly releaseKey: string;
    readonly state: AdmissionState;
  } | null>(null);
  const questionRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const previousQuestion = useRef<string | null>(null);
  const comparisonKeys = useComparisonSelection();

  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setLoadState({ status: "loading", progress: INITIAL_PROGRESS });
        setLoadAttempt((attempt) => attempt + 1);
      }
    };
    window.addEventListener("beforeunload", abort);
    window.addEventListener("pagehide", abort);
    window.addEventListener("pageshow", resume);
    void loadProfTestData(controller.signal, (progress) => {
      if (!controller.signal.aborted) setLoadState({ status: "loading", progress });
    }).then((data) => {
      if (!controller.signal.aborted) {
        const restored = readProfTestSession(data.releaseKey, data.categories);
        setFlow(restored ?? initialFlow());
        setDraftRestored(Boolean(restored));
        setLoadState({ status: "ready", data });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadState({ status: "error", message: errorMessage(error) });
    }).finally(() => window.removeEventListener("beforeunload", abort));
    return () => {
      window.removeEventListener("beforeunload", abort);
      window.removeEventListener("pagehide", abort);
      window.removeEventListener("pageshow", resume);
      controller.abort();
    };
  }, [loadAttempt]);

  const readyReleaseKey = loadState.status === "ready" ? loadState.data.releaseKey : null;
  const admissionState = admissionResult?.releaseKey === readyReleaseKey
    ? admissionResult.state
    : { status: "loading" as const };
  useEffect(() => {
    if (!readyReleaseKey) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    window.addEventListener("beforeunload", abort);
    window.addEventListener("pagehide", abort);
    void loadProfTestAdmissionStatus(readyReleaseKey, controller.signal).then((data) => {
      if (!controller.signal.aborted) setAdmissionResult({ releaseKey: readyReleaseKey, state: { status: "ready", data } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        profTestLog.warn("admission-load.release-or-contract-failure", { releaseKey: readyReleaseKey, error: error instanceof Error ? error.message : String(error) });
        setAdmissionResult({ releaseKey: readyReleaseKey, state: { status: "unavailable" } });
      }
    }).finally(() => window.removeEventListener("beforeunload", abort));
    return () => {
      window.removeEventListener("beforeunload", abort);
      window.removeEventListener("pagehide", abort);
      controller.abort();
    };
  }, [readyReleaseKey]);

  useEffect(() => {
    profTestLog.debug("flow.phase.changed", { phase: flow.phase, comparisonCount: flow.answers.comparisons.length, historyDepth: flow.history.length });
  }, [flow.answers.comparisons.length, flow.history.length, flow.phase]);

  useEffect(() => {
    if (flow.phase !== "results") return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ behavior, block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flow.phase]);

  useEffect(() => {
    const refreshScores = (event: StorageEvent) => {
      if (event.key === null || event.key === APPLICANT_PROFILE_KEY || event.key === LEGACY_APPLICANT_PROFILE_KEY) {
        setApplicantScores(readApplicantScores());
      }
    };
    window.addEventListener("storage", refreshScores);
    return () => window.removeEventListener("storage", refreshScores);
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  useEffect(() => {
    if (data) saveProfTestSession(data.releaseKey, flow);
  }, [data, flow]);
  useEffect(() => {
    if (!data || flow.phase === "results") return;
    const questionSignature = `${flow.phase}:${flow.currentPair?.left ?? ""}:${flow.currentPair?.right ?? ""}`;
    const shouldScroll = previousQuestion.current !== null && previousQuestion.current !== questionSignature;
    previousQuestion.current = questionSignature;
    const frame = requestAnimationFrame(() => {
      questionRef.current?.focus({ preventScroll: true });
      if (shouldScroll) questionRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, flow.phase, flow.currentPair?.left, flow.currentPair?.right]);
  const categoryByCode = useMemo(
    () => new Map((data?.categories ?? []).map((category) => [category.code, category])),
    [data],
  );
  const ranked = useMemo(
    () => data && flow.phase === "results" ? rankPrograms(data.profiles, flow.answers) : [],
    [data, flow.answers, flow.phase],
  );

  function updateAnswers(update: (answers: CareerTestAnswers) => CareerTestAnswers) {
    profTestLog.debug("answers.update.requested", { phase: flow.phase });
    setFlow((current) => ({ ...current, answers: update(current.answers) }));
    setFeedback("");
  }

  function toggleInterest(code: string) {
    if (code === UNKNOWN_INTEREST) {
      updateAnswers((answers) => ({
        ...answers,
        interests: answers.interests.includes(UNKNOWN_INTEREST) ? [] : [UNKNOWN_INTEREST],
      }));
      return;
    }
    const isSelected = flow.answers.interests.includes(code);
    if (!isSelected && flow.answers.interests.filter((item) => item !== UNKNOWN_INTEREST).length >= MAX_INTERESTS) {
      setFeedback(`Можно выбрать не больше ${MAX_INTERESTS} предметных областей.`);
      return;
    }
    updateAnswers((answers) => {
      const selected = answers.interests.includes(code);
      return {
        ...answers,
        interests: selected
          ? answers.interests.filter((item) => item !== code)
          : [...answers.interests.filter((item) => item !== UNKNOWN_INTEREST), code],
      };
    });
  }

  function toggleAvoid(code: string) {
    if (code === NO_AVOID) {
      updateAnswers((answers) => ({ ...answers, avoid: answers.avoid.includes(NO_AVOID) ? [] : [NO_AVOID] }));
      return;
    }
    const isSelected = flow.answers.avoid.includes(code);
    if (!isSelected && flow.answers.avoid.filter((item) => item !== NO_AVOID).length >= MAX_AVOID) {
      setFeedback(`Можно отметить не больше ${MAX_AVOID} нежелательных областей.`);
      return;
    }
    updateAnswers((answers) => {
      const selected = answers.avoid.includes(code);
      return {
        ...answers,
        avoid: selected ? answers.avoid.filter((item) => item !== code) : [...answers.avoid.filter((item) => item !== NO_AVOID), code],
      };
    });
  }

  function goBack() {
    profTestLog.debug("flow.back.requested", { phase: flow.phase, historyDepth: flow.history.length });
    setFeedback("");
    setFlow((current) => {
      const previous = current.history.at(-1);
      if (!previous) return current;
      const answers = previous.phase === "compare"
        ? previous.answers
        : {
            ...previous.answers,
            interests: current.answers.interests,
            activity: current.answers.activity,
            avoid: current.answers.avoid,
          };
      return { ...previous, answers, history: current.history.slice(0, -1) };
    });
  }

  function continueTest() {
    if (!data) return;
    profTestLog.info("flow.continue", { phase: flow.phase, comparisonCount: flow.answers.comparisons.length });
    setFeedback("");
    setFlow((current) => {
      if (current.phase === "interests") {
        return {
          phase: "activity",
          answers: current.answers,
          currentPair: null,
          draftComparison: null,
          history: [...current.history, snapshot(current)],
        };
      }
      if (current.phase === "activity") {
        return {
          phase: "avoid",
          answers: current.answers,
          currentPair: null,
          draftComparison: null,
          history: [...current.history, snapshot(current)],
        };
      }
      if (current.phase === "avoid") {
        const pair = selectAdaptivePair(data.profiles, data.categories, current.answers);
        return {
          phase: pair ? "compare" : "results",
          answers: current.answers,
          currentPair: pair,
          draftComparison: null,
          history: [...current.history, snapshot(current)],
        };
      }
      if (current.phase === "compare" && current.currentPair && current.draftComparison !== null) {
        const nextAnswers: CareerTestAnswers = {
          ...current.answers,
          comparisons: [...current.answers.comparisons, {
            left: current.currentPair.left,
            right: current.currentPair.right,
            value: current.draftComparison,
          }],
        };
        const finish = shouldFinishAfterComparison(
          data.profiles,
          current.answers,
          current.currentPair,
          current.draftComparison,
        );
        const pair = finish ? null : selectAdaptivePair(data.profiles, data.categories, nextAnswers);
        return {
          phase: finish || !pair ? "results" : "compare",
          answers: nextAnswers,
          currentPair: pair,
          draftComparison: null,
          history: [...current.history, snapshot(current)],
        };
      }
      return current;
    });
  }

  function restartTest() {
    profTestLog.info("flow.restart", { phase: flow.phase });
    setFlow(initialFlow());
    setFeedback("");
    setComparisonFeedback("");
    setDraftRestored(false);
  }

  function editAnswers() {
    setFlow({ ...initialFlow(), answers: { ...flow.answers, comparisons: [] } });
    setFeedback("");
  }

  function toggleComparison(programKey: string, selected: boolean) {
    if (!selected && comparisonKeys.length >= 3) {
      setComparisonFeedback("В сравнении уже три программы. Удалите одну на странице сравнения, чтобы добавить новую.");
      return;
    }
    if (comparisonSelection.toggle(programKey, !selected) === "unavailable") {
      setComparisonFeedback("Не удалось сохранить выбор. Проверь настройки браузера и повтори попытку.");
      return;
    }
    profTestLog.info("comparison-selection.changed", { programKey, selected: !selected, currentCount: comparisonKeys.length + (selected ? -1 : 1) });
    setComparisonFeedback(selected ? "Программа удалена из списка сравнения." : "Программа добавлена в список сравнения.");
  }

  function retryLoad() {
    setLoadState({ status: "loading", progress: INITIAL_PROGRESS });
    setLoadAttempt((attempt) => attempt + 1);
    setFeedback("");
  }

  const canContinue = flow.phase === "interests"
    ? flow.answers.interests.length > 0
    : flow.phase === "activity"
      ? Boolean(flow.answers.activity)
      : flow.phase === "avoid"
        ? true
        : flow.phase === "compare" && flow.draftComparison !== null;
  const step = phaseNumber(flow);
  const selectedMain = ranked.slice(0, 3);
  const alternatives = ranked.slice(3, 5);
  const hasRankingSignal = ranked.some((item) => item.score > 0);
  const hasSubjectPreference = [...preferenceWeights(flow.answers).values()].some((weight) => weight > 0);

  return (
    <div className={styles.page}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="prof-test-title">
          <div>
            <p className={styles.eyebrow}>НАЙДИ ТО, ЧТО ИНТЕРЕСНО ТЕБЕ</p>
            <h1 className={styles.title} id="prof-test-title">Проф-тест</h1>
            <p className={styles.description}>Расскажи, что тебе нравится и как ты любишь учиться. Мы предложим программы и объясним, чем они подходят.</p>
            <ul className={styles.introFacts}><li>5–7 коротких вопросов</li><li>Нет правильных и неправильных ответов</li><li>Можно вернуться и передумать</li></ul>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <section className={styles.shell} aria-label="Загрузка проф-теста" aria-busy="true">
            <div className={styles.loading} role="status" aria-live="polite">
              <span className={styles.loader} aria-hidden="true" />
              <strong>{loadState.progress.label}</strong>
              <span>Собираем проверенные учебные планы и предметные категории из одного активного выпуска.</span>
              {loadState.progress.total > 0 ? (
                <span>{formatCount(loadState.progress.completed)} из {formatCount(loadState.progress.total)} планов</span>
              ) : null}
            </div>
          </section>
        ) : null}

        {loadState.status === "error" ? (
          <section className={styles.shell} aria-label="Проф-тест недоступен">
            <div className={styles.unavailable} role="alert">
              <strong>Не удалось подключить учебные планы</strong>
              <p>{loadState.message}</p>
              <button className={`${styles.button} ${styles.buttonBlue}`} type="button" onClick={retryLoad}>Повторить загрузку</button>
            </div>
          </section>
        ) : null}

        {data && flow.phase !== "results" ? (
          <section className={styles.shell} aria-labelledby="test-experience-title" aria-busy="false">
            <h2 className={styles.srOnly} id="test-experience-title">Подбор образовательной программы</h2>
            <div className={styles.panel}>
              <header className={styles.progressHead}>
                <div>
                  <p className={styles.sectionKicker}>Твой маршрут</p>
                  <p className={styles.stepCount}>Вопрос {step} · обычно 5–7</p>
                </div>
                <button className={styles.restartLink} type="button" onClick={restartTest}>Начать заново</button>
              </header>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Ход теста"
                aria-valuemin={1}
                aria-valuemax={7}
                aria-valuenow={step}
              >
                <span style={{ width: `${Math.min(100, (step / 7) * 100)}%` }} />
              </div>
              <ol className={styles.flowSteps} aria-label="Этапы подбора">
                {["Интересы", "Как учиться", "Что ближе", "Результат"].map((label, index) => <li key={label} aria-current={(flow.phase === "interests" ? 0 : flow.phase === "activity" ? 1 : 2) === index ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}
              </ol>
              <p className={styles.sourceNote}>{draftRestored ? "Продолжим с сохранённого шага. " : ""}Сравним твои интересы с содержанием {data.profiles.length} программ. Ответы сохраняются в этой вкладке.</p>

              <section className={styles.question} ref={questionRef} tabIndex={-1} aria-labelledby="prof-question-title">
                {flow.phase === "interests" ? (
                  <>
                    <QuestionHeading title="Что тебе интересно изучать?" description="Выбери от одной до пяти тем, которые хочется попробовать. Неважно, насколько хорошо ты уже в них разбираешься." />
                    <button className={styles.unsureChoice} type="button" aria-pressed={flow.answers.interests.includes(UNKNOWN_INTEREST)} onClick={() => toggleInterest(UNKNOWN_INTEREST)}>Пока трудно выбрать <span>Помогут следующие вопросы</span></button>
                    <div className={`${styles.choiceGrid} ${styles.categoryChoiceGrid}`}>
                      {data.categories.map((category) => (
                        <CategoryChoice
                          key={category.code}
                          category={category}
                          pressed={flow.answers.interests.includes(category.code)}
                          disabled={!flow.answers.interests.includes(category.code) && flow.answers.interests.filter((item) => item !== UNKNOWN_INTEREST).length >= MAX_INTERESTS}
                          onClick={() => toggleInterest(category.code)}
                        />
                      ))}
                    </div>
                    <div className={styles.choiceGridFooter}>
                      <span>Можно выбрать несколько областей — это не ограничивает список программ.</span>
                      <span className={styles.choiceLimit}>{flow.answers.interests.filter((item) => item !== UNKNOWN_INTEREST).length} из {MAX_INTERESTS} выбрано</span>
                    </div>
                  </>
                ) : null}

                {flow.phase === "activity" ? (
                  <>
                    <QuestionHeading title="Какой формат учебной работы тебе ближе?" description="Представь обычный учебный день. Что тебе приятнее делать? Выбери один вариант или пропусти, если всё зависит от предмета." />
                    <div className={styles.choiceGrid}>
                      {ACTIVITY_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          className={`${styles.choiceCard} ${styles.choiceCardActivity}`}
                          type="button"
                          aria-pressed={flow.answers.activity === option.key}
                          onClick={() => updateAnswers((answers) => ({ ...answers, activity: option.key }))}
                        >
                          <span className={styles.activityIcon} aria-hidden="true">{option.icon}</span>
                          <strong>{option.title}</strong>
                          <span>{option.detail}</span>
                        </button>
                      ))}
                      <button
                        className={`${styles.choiceCard} ${styles.choiceCardCompact}`}
                        type="button"
                        aria-pressed={flow.answers.activity === NO_ACTIVITY}
                        onClick={() => updateAnswers((answers) => ({ ...answers, activity: NO_ACTIVITY }))}
                      >
                        <span className={styles.choiceKicker}>ЛЮБОЙ ФОРМАТ</span>
                        <strong>Не уверен — пропустить</strong>
                        <span>Тогда учтём только интересы.</span>
                      </button>
                    </div>
                    <div className={styles.choiceGridFooter}><span>Интересы важнее формата. Мы учитываем формат только при наличии сопоставимых данных в учебных планах.</span></div>
                  </>
                ) : null}

                {flow.phase === "avoid" ? (
                  <>
                    <QuestionHeading title="Какие области хотелось бы изучать меньше?" description="Необязательный вопрос. Выбери до трёх тем или просто продолжи. Мы учтём пожелание, но не исключим программы целиком." />
                    <div className={`${styles.choiceGrid} ${styles.categoryChoiceGrid}`}>
                      {data.categories.map((category) => (
                        <CategoryChoice
                          key={category.code}
                          category={category}
                          pressed={flow.answers.avoid.includes(category.code)}
                          disabled={!flow.answers.avoid.includes(category.code) && flow.answers.avoid.filter((item) => item !== NO_AVOID).length >= MAX_AVOID}
                          onClick={() => toggleAvoid(category.code)}
                        />
                      ))}
                      <button
                        className={`${styles.choiceCard} ${styles.choiceCardCompact}`}
                        type="button"
                        aria-pressed={flow.answers.avoid.includes(NO_AVOID)}
                        onClick={() => toggleAvoid(NO_AVOID)}
                      >
                        <span className={styles.choiceKicker}>МОЖНО ПРОПУСТИТЬ</span>
                        <strong>Готов попробовать всё</strong>
                        <span>Нет тем, которых хочется избегать.</span>
                      </button>
                    </div>
                    <div className={styles.choiceGridFooter}>
                      <span>Нежелательные области не удаляют программу из рекомендаций.</span>
                      <span className={styles.choiceLimit}>{flow.answers.avoid.filter((item) => item !== NO_AVOID).length} из {MAX_AVOID} выбрано</span>
                    </div>
                  </>
                ) : null}

                {flow.phase === "compare" ? (
                  <>
                    {flow.currentPair ? (
                      <>
                        <QuestionHeading title="Что из двух хочется изучать чаще?" description="Представь, что выбираешь занятие на свободный день. Что тебя больше увлечёт? Если разницы нет или не нравятся обе темы, выбери «Одинаково»." />
                        <div className={styles.pairQuestion}>
                          <PairSide category={categoryByCode.get(flow.currentPair.left)} label="A" />
                          <span className={styles.pairVs}>ИЛИ</span>
                          <PairSide category={categoryByCode.get(flow.currentPair.right)} label="B" />
                        </div>
                        <div className={styles.pairOptions} role="group" aria-label="Первое или второе занятие">
                          {PAIR_CHOICES.map((choice) => (
                            <button
                              key={choice.value}
                              className={styles.pairOption}
                              type="button"
                              aria-label={choice.title}
                              aria-pressed={flow.draftComparison === choice.value}
                              onClick={() => {
                                setFlow((current) => ({ ...current, draftComparison: choice.value }));
                                setFeedback("");
                              }}
                            >
                              <span>{choice.title}</span>
                              <small>{choice.note}</small>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className={styles.feedback}>Для нового сравнения недостаточно разных предметных областей. Покажем результаты по уже данным ответам.</p>
                    )}
                  </>
                ) : null}
              </section>

              <p className={styles.feedback} aria-live="polite">{feedback}</p>
              <footer className={styles.controls}>
                {flow.history.length > 0 ? <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={goBack}>Назад</button> : <span />}
                <span className={styles.controlsHint}>
                  {flow.phase === "compare" ? `${flow.answers.comparisons.length + 1} из ${MAX_COMPARISONS} сравнений максимум` : flow.phase === "avoid" ? "Этот вопрос можно пропустить" : "Ответ можно изменить кнопкой «Назад»"}
                </span>
                <button className={`${styles.button} ${styles.buttonBlue}`} type="button" disabled={!canContinue} onClick={continueTest}>{questionActionLabel(flow, data)}</button>
              </footer>
            </div>
          </section>
        ) : null}

        {data && flow.phase === "results" ? (
          <section className={styles.results} aria-labelledby="results-title">
            <header ref={resultsRef} className={styles.resultsIntro} tabIndex={-1}>
              <div>
                <p className={styles.sectionKicker}>РЕЗУЛЬТАТ ПО УЧЕБНОМУ ПЛАНУ</p>
                <h2 id="results-title">{hasRankingSignal ? "Твои подходящие программы" : "Пока не получилось выделить совпадение"}</h2>
                <p>Это отправная точка для выбора. Посмотри, какие темы есть в программах, добавь интересные варианты в сравнение и проверь условия поступления.</p>
              </div>
              <div className={styles.resultsTotal}><strong>{formatCount(ranked.length)}</strong><span>программ с данными для сравнения</span></div>
            </header>
            <div className={styles.resultsMethodNote}>
              Чем выше совпадение, тем ближе содержание программы к твоим ответам. Этот индекс не оценивает твои способности и не предсказывает поступление.
            </div>
            <section className={styles.answerSummary} aria-label="Твои предпочтения">
              <div><h3>Твои предпочтения</h3><p>{flow.answers.interests.filter((code) => code !== UNKNOWN_INTEREST).map((code) => categoryByCode.get(code)).filter((category): category is SubjectCategory => Boolean(category)).map((category) => categoryPresentation(category).title).join(" · ") || "Интересы уточнялись в сравнениях"}</p><p>{ACTIVITY_OPTIONS.find((option) => option.key === flow.answers.activity)?.title ?? "Формат занятий без предпочтения"}</p>{flow.answers.avoid.some((code) => code !== NO_AVOID) ? <p>Хочется меньше: {flow.answers.avoid.filter((code) => code !== NO_AVOID).map((code) => categoryByCode.get(code)?.name).filter(Boolean).join(" · ")}</p> : null}</div>
              <div className={styles.answerSummaryActions}>
                <a className={styles.restartLink} href="#prof-program-search">Все программы и поиск ↓</a>
                <button type="button" className={styles.restartLink} onClick={editAnswers}>Уточнить интересы</button>
              </div>
            </section>
            {hasRankingSignal && !hasSubjectPreference ? <p className={styles.resultsMethodNote} role="status">Пока подбор опирается только на формат занятий. Уточни интересы, чтобы программы различались и по содержанию дисциплин.</p> : null}
            {!hasRankingSignal ? (
              <p className={styles.resultsMethodNote} role="status">Ты пока не выделил любимые темы или формат занятий. Можно уточнить интересы или посмотреть все программы ниже — без персональной оценки.</p>
            ) : null}
            {hasRankingSignal ? <div className={styles.resultsGrid}>
              {selectedMain.map((item, index) => (
                <RecommendationCard
                  key={item.profile.program.external_key}
                  item={item}
                  rank={index + 1}
                  categories={categoryByCode}
                  answers={flow.answers}
                  admissionState={admissionState}
                  applicantScores={applicantScores}
                  comparisonKeys={comparisonKeys}
                  onToggleComparison={toggleComparison}
                />
              ))}
            </div> : null}
            {hasRankingSignal && alternatives.length > 0 ? (
              <section className={styles.alternativeSection} aria-labelledby="alternative-title">
                <header className={styles.alternativeHeading}>
                  <div><p className={styles.sectionKicker}>ЕЩЁ ВАРИАНТЫ</p><h3 id="alternative-title">Другие варианты</h3></div>
                  <p>Их содержание может заметно отличаться от первого варианта. Сравни совпадения и темы, которые занимают больше всего времени.</p>
                </header>
                <div className={styles.alternativeGrid}>
                  {alternatives.map((item, index) => (
                    <RecommendationCard
                      key={item.profile.program.external_key}
                      item={item}
                      rank={index + 4}
                      alternative
                      categories={categoryByCode}
                      answers={flow.answers}
                      admissionState={admissionState}
                      applicantScores={applicantScores}
                      comparisonKeys={comparisonKeys}
                      onToggleComparison={toggleComparison}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {comparisonFeedback ? <p className={styles.actionFeedback} role="status" aria-live="polite">{comparisonFeedback}</p> : null}
            <ProgramResults key={`${data.releaseKey}:${flow.answers.comparisons.length}`} data={data} ranked={ranked} hasSignal={hasRankingSignal} comparisonKeys={comparisonKeys} onToggleComparison={toggleComparison} />
            <details className={styles.resultsDataNote}><summary>Как устроен подбор и какие данные учтены</summary><p>
              Активный академический выпуск: {activeProfileSource(data)}. Индекс учитывает доли часов по интересам, формат занятий и небольшой штраф за нежелательные области. Помеченные Jev для проверки назначения участвуют как наиболее вероятные.
              Учтено {formatCount(ranked.length)} из {formatCount(data.programs.length)} программ. В {formatCount(data.totalCurriculumRows)} строках учебных планов назначена категория для {formatCount(data.assignedRows)} строк; Jev пометил {formatCount(data.reviewRows)} {russianPlural(data.reviewRows, ["назначение для проверки", "назначения для проверки", "назначений для проверки"])}. Такие категории учитываются как наиболее вероятные.
              {data.assignedRows < data.totalCurriculumRows ? ` Ещё ${formatCount(data.totalCurriculumRows - data.assignedRows)} строк в источнике без назначения категории.` : ""}
              {data.unavailableProgramCount > 0 ? ` Для ${formatCount(data.unavailableProgramCount)} программ актуальный подтверждённый план недоступен.` : ""}
            </p></details>
            <footer className={styles.resultsFooter}>
              <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={goBack}>Изменить ответы</button>
              <Link className={`${styles.button} ${styles.buttonBlue}`} to="/compare">Сравнить программы{comparisonKeys.length ? ` (${comparisonKeys.length})` : ""}</Link>
              <button className={styles.restartLink} type="button" onClick={restartTest}>Пройти заново</button>
            </footer>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function QuestionHeading({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <header className={styles.questionHeading}>
      <h2 id="prof-question-title">{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function CategoryChoice({
  category,
  pressed,
  disabled,
  onClick,
}: {
  readonly category: SubjectCategory;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const copy = categoryPresentation(category);
  return (
    <button
      className={styles.choiceCard}
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <strong>{copy.title}</strong>
      <span className={styles.choiceDetail}>{copy.detail}</span>
      <span className={styles.srOnly}>{category.name}</span>
    </button>
  );
}

function PairSide({ category, label }: { readonly category: SubjectCategory | undefined; readonly label: "A" | "B" }) {
  if (!category) return <article className={styles.pairSide} aria-label={`Область ${label} недоступна`}><span>Область {label} недоступна</span></article>;
  const copy = categoryPresentation(category);
  return (
    <article className={styles.pairSide}>
      <span className={styles.pairSideLabel}>{label === "A" ? "Первое занятие" : "Второе занятие"}</span>
      <h3>{copy.title}</h3>
      <p>{copy.detail}</p>
    </article>
  );
}

function RecommendationCard({
  item,
  rank,
  alternative = false,
  categories,
  answers,
  admissionState,
  applicantScores,
  comparisonKeys,
  onToggleComparison,
}: {
  readonly item: ReturnType<typeof rankPrograms>[number];
  readonly rank: number;
  readonly alternative?: boolean;
  readonly categories: ReadonlyMap<string, SubjectCategory>;
  readonly answers: CareerTestAnswers;
  readonly admissionState: AdmissionState;
  readonly applicantScores: Readonly<Record<string, unknown>>;
  readonly comparisonKeys: readonly string[];
  readonly onToggleComparison: (programKey: string, selected: boolean) => void;
}) {
  const { profile, score, positivePreferences, activityFit } = item;
  const program = profile.program;
  const selected = comparisonKeys.includes(program.external_key);
  const matches = positivePreferences
    .map(([code, weight]) => ({ code, weight, share: profile.categoryShares.get(code) ?? 0, contribution: weight * normalizedCategoryShare(profile, code) }))
    .filter((match) => match.share > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 3);
  const avoids = answers.avoid
    .filter((code) => code !== NO_AVOID)
    .map((code) => ({ code, share: profile.categoryShares.get(code) ?? 0 }))
    .filter((avoid) => avoid.share > 0)
    .sort((left, right) => right.share - left.share)
    .slice(0, 2);
  const coverage = profile.totalHours > 0 ? Math.min(1, profile.assignedHours / profile.totalHours) : 0;
  const sourceUrl = safeExternalUrl(profile.plan.document_url ?? profile.plan.study_plan_url ?? profile.plan.download_url);
  const activity = ACTIVITY_OPTIONS.find((option) => option.key === answers.activity);
  const requirements = admissionState.status === "ready"
    ? admissionState.data.requirementsByDirection.get(program.direction_key) ?? []
    : [];
  const requirementsCount = requirements.length;
  const scoreStatus = admissionState.status === "ready" && admissionState.data.status === "ready"
    ? admissionScoreStatus(requirements, applicantScores)
    : null;
  const admissionStatus = admissionState.status === "loading"
    ? "загружаем условия"
    : admissionState.status === "unavailable" || admissionState.data.status === "unavailable"
      ? "условия не загружены"
      : scoreStatus === "no-requirements"
        ? "недостаточно данных"
        : scoreStatus === "no-scores"
          ? "баллы не добавлены"
          : scoreStatus === "passed-all"
            ? "показанные минимумы пройдены"
            : scoreStatus === "passed-some"
              ? "один из наборов минимумов пройден"
              : scoreStatus === "failed-all"
                ? "показанные минимумы не пройдены"
                : "недостаточно баллов для сверки";
  const admissionNote = admissionState.status === "loading"
    ? "Проверка опубликованных минимумов отдельно от подбора и не является прогнозом зачисления."
    : admissionState.status === "unavailable" || admissionState.data.status === "unavailable"
      ? "Не удалось получить опубликованные условия. Подбор учебных направлений работает отдельно."
      : scoreStatus === "no-requirements"
        ? "Для направления не нашлись опубликованные минимумы в подключённом архиве."
        : scoreStatus === "no-scores"
          ? `Опубликовано ${requirementsCount} ${russianPlural(requirementsCount, ["набор условий поступления", "набора условий поступления", "наборов условий поступления"])}. Открой условия направления, чтобы посмотреть предметы и минимальные баллы. Порядок рекомендаций от баллов не зависит.`
          : scoreStatus === "incomplete"
            ? "Сверяем сохранённые баллы из профиля. Для полного результата не хватает допустимых оценок от 0 до 100. Эта проверка не меняет подбор."
            : "Сверены сохранённые баллы из профиля. Выполнение минимума не гарантирует зачисление и не меняет порядок рекомендаций.";

  return (
    <article className={`${styles.recommendationCard} ${rank === 1 ? styles.featured : ""}`}>
      <div className={styles.recommendationTop}>
        <span className={styles.recommendationRank}>{alternative ? `АЛЬТЕРНАТИВА ${rank - 3}` : `ВАРИАНТ ${String(rank).padStart(2, "0")}`}</span>
        <span className={styles.recommendationCode}>{program.code || "Код не указан"}</span>
      </div>
      <h3>{program.name || "Образовательная программа"}</h3>
      <p className={styles.recommendationDirection}>{[program.directionCode, program.directionName].filter(Boolean).join(" · ") || "Направление не указано"}</p>
      <div className={styles.fitIndex}>
        <div className={styles.fitIndexTop}><span>Совпадение с ответами</span><strong>{Math.round(score)} / 100</strong></div>
        <div className={styles.fitIndexTrack} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div>
        <span className={styles.fitIndexCaption}>Относительный индекс по программам каталога, не шанс поступления</span>
      </div>
      {matches.length > 0 ? (
        <section className={styles.recommendationReasons}>
          <h4>Ближе всего по содержанию</h4>
          <div className={styles.reasonBars}>
            {matches.map((match) => (
              <div className={styles.reasonBar} key={match.code}><div><span>{categories.get(match.code)?.name ?? `Категория ${match.code}`}</span><strong>{percent(match.share)}</strong></div><span className={styles.reasonTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, match.share * 100)}%` }} /></span></div>
            ))}
          </div>
          <p className={styles.reasonCaption}>Доля указанных часов учебного плана</p>
        </section>
      ) : null}
      {avoids.length > 0 ? (
        <section className={styles.recommendationReasons}>
          <h4>Проверь нежелательные темы</h4>
          <div className={styles.reasonChipList}>
            {avoids.map((avoid) => (
              <span className={`${styles.reasonChip} ${styles.avoidChip}`} key={avoid.code}>{categories.get(avoid.code)?.name ?? `Категория ${avoid.code}`} <strong>{percent(avoid.share)}</strong></span>
            ))}
          </div>
        </section>
      ) : null}
      <details className={styles.recommendationData}>
        <summary>Учебный план и источники</summary>
        <p>
        <strong>{formatCount(profile.totalHours)} ч</strong> в учебном плане · категория назначена для <strong>{percent(coverage)}</strong> указанных часов
        {activityFit !== null && activity ? <><br />{activity.title}: {percent(profile.activityShares[activity.key])} распределённых часов</> : null}
        {profile.reviewRows > 0 ? <><br />Jev пометил для проверки {formatCount(profile.reviewRows)} {russianPlural(profile.reviewRows, ["строку", "строки", "строк"])}; в индексе использована наиболее вероятная категория.</> : null}
        {profile.reviewRows === 0 && profile.assignedRows > 0 ? <><br />Все назначенные категории этого плана отмечены как классифицированные.</> : null}
        {sourceUrl ? <><br /><a className={styles.sourceLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">Оригинал учебного плана ↗</a></> : null}
        </p>
      </details>
      <section className={styles.admissionFit} aria-label="Условия поступления">
        <strong>Поступление · {admissionStatus}</strong>
        <span>{admissionNote}</span>
        <Link to={`/programs?direction=${encodeURIComponent(program.directionCode ?? "")}`}>Все условия направления ↗</Link>
      </section>
      <div className={styles.recommendationActions}>
        <Link className={`${styles.button} ${styles.buttonSecondary}`} to={`/programs?code=${encodeURIComponent(program.code)}`}>Подробнее о программе</Link>
        <button
          className={`${styles.button} ${styles.buttonSecondary} ${styles.compareToggle}`}
          type="button"
          aria-pressed={selected}
          onClick={() => onToggleComparison(program.external_key, selected)}
        >
          {selected ? "Добавлено ✓" : "В сравнение"}
        </button>
      </div>
    </article>
  );
}
