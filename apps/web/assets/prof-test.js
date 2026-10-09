(() => {
  const MAX_COMPARISONS = 4;
  const MAX_INTERESTS = 5;
  const MAX_AVOID = 3;
  const UNKNOWN = "__unknown__";
  const NO_AVOID = "__none__";
  const activityOptions = [
    { key: "lecture_hours", icon: "01", title: "Слушать и разбираться", detail: "Лекции и объяснение основ" },
    { key: "practice_hours", icon: "02", title: "Решать задачи", detail: "Практические занятия и применение методов" },
    { key: "lab_hours", icon: "03", title: "Собирать и проверять", detail: "Лабораторные и экспериментальная работа" },
    { key: "self_study_hours", icon: "04", title: "Изучать самому", detail: "Самостоятельная работа по плану" },
  ];
  const pairChoices = [
    { value: 2, title: "Сильно A", note: "гораздо ближе" },
    { value: 1, title: "Скорее A", note: "немного ближе" },
    { value: 0, title: "Одинаково", note: "обе области" },
    { value: -1, title: "Скорее B", note: "немного ближе" },
    { value: -2, title: "Сильно B", note: "гораздо ближе" },
  ];
  const elements = {
    loading: document.getElementById("testLoading"),
    unavailable: document.getElementById("testUnavailable"),
    panel: document.getElementById("testPanel"),
    sourceNote: document.getElementById("testSourceNote"),
    question: document.getElementById("testQuestion"),
    stepCount: document.getElementById("testStepCount"),
    progress: document.getElementById("testProgress"),
    progressFill: document.getElementById("testProgressFill"),
    feedback: document.getElementById("testFeedback"),
    controlsHint: document.getElementById("testControlsHint"),
    previous: document.getElementById("previousQuestion"),
    next: document.getElementById("nextQuestion"),
    results: document.getElementById("testResults"),
    resultsSummary: document.getElementById("resultsSummary"),
    resultsCount: document.getElementById("resultsCount"),
    resultsMethod: document.getElementById("resultsMethodNote"),
    mainRecommendations: document.getElementById("mainRecommendations"),
    alternativeSection: document.getElementById("alternativeSection"),
    alternativeRecommendations: document.getElementById("alternativeRecommendations"),
    resultsDataNote: document.getElementById("resultsDataNote"),
  };

  let programs = [];
  let profiles = [];
  let categories = [];
  let admission = null;
  let dataSource = "api";
  let failedPlans = 0;
  let totalCurriculumRows = 0;
  let classifiedRows = 0;
  let admissionPromise = null;
  let admissionReady = false;
  let state = freshState();

  function freshState() {
    return {
      phase: "interests",
      interests: [],
      activity: "",
      avoid: [],
      comparisons: [],
      currentPair: null,
      draftComparison: null,
      history: [],
    };
  }

  function text(value) { return Andromeda.text(value); }
  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function programKey(program) { return text(program.external_key) || text(program.code); }
  function add(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = value;
    parent.append(node);
    return node;
  }
  function percent(value, digits = 0) {
    if (!Number.isFinite(value)) return "—";
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value * 100)}%`;
  }
  function stepNumber() {
    if (state.phase === "interests") return 1;
    if (state.phase === "activity") return 2;
    if (state.phase === "avoid") return 3;
    if (state.phase === "compare") return 4 + state.comparisons.length;
    return Math.min(7, 4 + state.comparisons.length);
  }

  function updateProgress() {
    const step = stepNumber();
    elements.stepCount.textContent = `Вопрос ${step} · обычно 5–7`;
    elements.progress.setAttribute("aria-valuenow", String(step));
    elements.progressFill.style.width = `${Math.min(100, step / 7 * 100)}%`;
    elements.previous.hidden = state.history.length === 0;
  }

  function pushHistory() {
    state.history.push({
      phase: state.phase,
      interests: [...state.interests],
      activity: state.activity,
      avoid: [...state.avoid],
      comparisons: state.comparisons.map((item) => ({ ...item })),
      currentPair: state.currentPair ? { ...state.currentPair } : null,
      draftComparison: state.draftComparison,
    });
  }

  function previousQuestion() {
    const previous = state.history.pop();
    if (!previous) return;
    state = { ...previous, history: state.history };
    elements.results.hidden = true;
    elements.panel.hidden = false;
    renderQuestion();
    elements.question.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function setToggle(button, enabled) {
    button.setAttribute("aria-pressed", String(enabled));
  }

  function createChoiceCard({ code, title, detail, kicker, pressed, className = "", onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice-card ${className}`.trim();
    button.dataset.choice = code;
    setToggle(button, pressed);
    if (kicker) add(button, "span", "choice-card-kicker", kicker);
    add(button, "strong", "", title);
    if (detail) add(button, "span", "", detail);
    button.addEventListener("click", onClick);
    return button;
  }

  function updateNextButton() {
    let enabled = false;
    if (state.phase === "interests") enabled = state.interests.length > 0;
    else if (state.phase === "activity") enabled = Boolean(state.activity);
    else if (state.phase === "avoid") enabled = true;
    else if (state.phase === "compare") enabled = state.draftComparison !== null;
    elements.next.disabled = !enabled;
    elements.feedback.textContent = "";
  }

  function renderQuestion() {
    elements.question.replaceChildren();
    elements.panel.hidden = false;
    elements.results.hidden = true;
    updateProgress();
    updateNextButton();
    const renderers = {
      interests: renderInterestsQuestion,
      activity: renderActivityQuestion,
      avoid: renderAvoidQuestion,
      compare: renderCompareQuestion,
    };
    (renderers[state.phase] || renderInterestsQuestion)();
    elements.next.textContent = state.phase === "compare" && shouldFinishAfterDraft() ? "Показать результат" : "Продолжить";
    elements.controlsHint.textContent = state.phase === "compare"
      ? `${state.comparisons.length + 1} из 4 сравнений максимум`
      : state.phase === "avoid" ? "Можно пропустить этот вопрос" : "Ответ можно изменить кнопкой «Назад»";
  }

  function addQuestionHeading(title, description) {
    const heading = document.createElement("header");
    heading.className = "question-heading";
    add(heading, "h2", "", title);
    add(heading, "p", "", description);
    elements.question.append(heading);
  }

  function renderInterestsQuestion() {
    addQuestionHeading(
      "Что тебе интересно изучать?",
      "Выбери до пяти областей. Это предметные категории из классификатора учебных планов, а не готовые профессии."
    );
    const grid = document.createElement("div");
    grid.className = "choice-grid category-choice-grid";
    for (const category of categories) {
      const code = category.code;
      const button = createChoiceCard({
        code,
        title: category.name,
        detail: category.definition,
        kicker: `ОБЛАСТЬ ${code}`,
        pressed: state.interests.includes(code),
        onClick: (event) => {
          const selected = state.interests.includes(code);
          if (!selected && state.interests.length >= MAX_INTERESTS) return;
          state.interests = selected ? state.interests.filter((item) => item !== code) : [...state.interests.filter((item) => item !== UNKNOWN), code];
          const card = event.currentTarget;
          setToggle(card, !selected);
          const count = elements.question.querySelector("[data-interest-count]");
          if (count) count.textContent = `${state.interests.filter((item) => item !== UNKNOWN).length} из ${MAX_INTERESTS} выбрано`;
          updateNextButton();
        },
      });
      grid.append(button);
    }
    grid.append(createChoiceCard({
      code: UNKNOWN,
      title: "Пока трудно выбрать",
      detail: "Подбор продолжится по формату занятий и сравнениям областей.",
      kicker: "НЕ ОБЯЗАТЕЛЬНО ЗНАТЬ ЗАРАНЕЕ",
      className: "choice-card-compact",
      pressed: state.interests.includes(UNKNOWN),
      onClick: (event) => {
        const enabled = !state.interests.includes(UNKNOWN);
        state.interests = enabled ? [UNKNOWN] : [];
        elements.question.querySelectorAll("[data-choice]").forEach((button) => setToggle(button, button.dataset.choice === UNKNOWN && enabled));
        updateNextButton();
      },
    }));
    elements.question.append(grid);
    const footer = document.createElement("div");
    footer.className = "choice-grid-footer";
    add(footer, "span", "", "Можно выбрать одну область или несколько — это не ограничивает список программ.");
    const count = add(footer, "span", "choice-limit", `${state.interests.filter((item) => item !== UNKNOWN).length} из ${MAX_INTERESTS} выбрано`);
    count.dataset.interestCount = "true";
    elements.question.append(footer);
  }

  function renderActivityQuestion() {
    addQuestionHeading(
      "Какой формат учебной работы тебе ближе?",
      "Мы учтём, сколько таких часов действительно указано в учебном плане. Выбери то, чего хотелось бы больше."
    );
    const grid = document.createElement("div");
    grid.className = "choice-grid";
    for (const option of activityOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-card choice-card-activity";
      button.dataset.choice = option.key;
      setToggle(button, state.activity === option.key);
      add(button, "span", "activity-icon", option.icon);
      add(button, "strong", "", option.title);
      add(button, "span", "", option.detail);
      button.addEventListener("click", () => {
        state.activity = option.key;
        grid.querySelectorAll("[data-choice]").forEach((choice) => setToggle(choice, choice.dataset.choice === option.key));
        updateNextButton();
      });
      grid.append(button);
    }
    elements.question.append(grid);
  }

  function renderAvoidQuestion() {
    addQuestionHeading(
      "Каких областей хотелось бы поменьше?",
      "Отсутствие интереса и явное «не хочу» — разные ответы. Выбери до трёх нежелательных областей, или отметь, что таких пока нет."
    );
    const grid = document.createElement("div");
    grid.className = "choice-grid category-choice-grid";
    for (const category of categories) {
      const code = category.code;
      grid.append(createChoiceCard({
        code,
        title: category.name,
        detail: category.definition,
        kicker: `ОБЛАСТЬ ${code}`,
        pressed: state.avoid.includes(code),
        onClick: (event) => {
          const selected = state.avoid.includes(code);
          if (!selected && state.avoid.length >= MAX_AVOID) return;
          state.avoid = selected ? state.avoid.filter((item) => item !== code) : [...state.avoid.filter((item) => item !== NO_AVOID), code];
          setToggle(event.currentTarget, !selected);
          const none = grid.querySelector(`[data-choice="${NO_AVOID}"]`);
          if (none) setToggle(none, false);
          const count = elements.question.querySelector("[data-avoid-count]");
          if (count) count.textContent = `${state.avoid.filter((item) => item !== NO_AVOID).length} из ${MAX_AVOID} выбрано`;
        },
      }));
    }
    grid.append(createChoiceCard({
      code: NO_AVOID,
      title: "Нет выраженного стоп-листа",
      detail: "Пусть тест сравнивает программы по тому, что тебе интересно.",
      kicker: "МОЖНО ПРОПУСТИТЬ",
      className: "choice-card-compact",
      pressed: state.avoid.includes(NO_AVOID),
      onClick: (event) => {
        const enabled = !state.avoid.includes(NO_AVOID);
        state.avoid = enabled ? [NO_AVOID] : [];
        grid.querySelectorAll("[data-choice]").forEach((button) => setToggle(button, button.dataset.choice === NO_AVOID && enabled));
        const count = elements.question.querySelector("[data-avoid-count]");
        if (count) count.textContent = "Стоп-лист не задан";
      },
    }));
    elements.question.append(grid);
    const footer = document.createElement("div");
    footer.className = "choice-grid-footer";
    add(footer, "span", "", "Нежелательные области снижают совпадение, если занимают заметную долю плана.");
    const count = add(footer, "span", "choice-limit", `${state.avoid.filter((item) => item !== NO_AVOID).length} из ${MAX_AVOID} выбрано`);
    count.dataset.avoidCount = "true";
    elements.question.append(footer);
  }

  function renderCompareQuestion() {
    if (!state.currentPair) state.currentPair = selectAdaptivePair();
    const left = categoryByCode(state.currentPair?.left);
    const right = categoryByCode(state.currentPair?.right);
    if (!left || !right) {
      elements.feedback.textContent = "Для нового сравнения недостаточно разных предметных областей. Покажем результаты по уже данным ответам.";
      elements.next.disabled = false;
      return;
    }
    addQuestionHeading(
      "Что из двух хочется изучать чаще?",
      "Сейчас сравним области, которые сильнее всего различают программы в предварительной подборке."
    );
    const pair = document.createElement("div");
    pair.className = "pair-question";
    pair.append(renderPairSide(left, "A"));
    add(pair, "span", "pair-vs", "ИЛИ");
    pair.append(renderPairSide(right, "B"));
    elements.question.append(pair);
    const options = document.createElement("div");
    options.className = "pair-options";
    for (const choice of pairChoices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pair-option";
      button.dataset.value = String(choice.value);
      setToggle(button, state.draftComparison !== null && Number(state.draftComparison) === choice.value);
      add(button, "span", "", choice.title);
      add(button, "small", "", choice.note);
      button.addEventListener("click", () => {
        state.draftComparison = choice.value;
        options.querySelectorAll("[data-value]").forEach((option) => setToggle(option, Number(option.dataset.value) === choice.value));
        updateNextButton();
        elements.next.textContent = shouldFinishAfterDraft() ? "Показать результат" : "Продолжить";
      });
      options.append(button);
    }
    elements.question.append(options);
  }

  function renderPairSide(category, label) {
    const side = document.createElement("article");
    side.className = "pair-side";
    add(side, "span", "pair-side-label", `Область ${label} · ${category.code}`);
    add(side, "h3", "", category.name);
    add(side, "p", "", category.definition);
    return side;
  }

  function categoryByCode(code) { return categories.find((item) => item.code === String(code)); }

  function continueQuestion() {
    if (elements.next.disabled) return;
    if (state.phase === "interests") {
      pushHistory();
      state.phase = "activity";
      state.activity = "";
    } else if (state.phase === "activity") {
      pushHistory();
      state.phase = "avoid";
      state.avoid = [];
    } else if (state.phase === "avoid") {
      pushHistory();
      state.phase = "compare";
      state.currentPair = selectAdaptivePair();
      state.draftComparison = null;
      if (!state.currentPair) {
        showResults();
        return;
      }
    } else if (state.phase === "compare") {
      const beforeTop = rankedPrograms().slice(0, 3).map((item) => programKey(item.profile.program));
      pushHistory();
      state.comparisons.push({
        left: state.currentPair.left,
        right: state.currentPair.right,
        value: Number(state.draftComparison),
      });
      state.draftComparison = null;
      const ranked = rankedPrograms();
      const afterTop = ranked.slice(0, 3).map((item) => programKey(item.profile.program));
      const topStable = beforeTop.length === afterTop.length && beforeTop.every((key) => afterTop.includes(key));
      const separation = ranked.length > 3 ? ranked[2].score - ranked[3].score : Infinity;
      const stableShortlist = state.comparisons.length >= 2 && topStable && separation >= 3.5;
      if (state.comparisons.length >= MAX_COMPARISONS || stableShortlist || !selectAdaptivePair()) {
        showResults();
        return;
      }
      state.currentPair = selectAdaptivePair();
      state.phase = "compare";
    }
    renderQuestion();
    elements.question.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function shouldFinishAfterDraft() {
    if (state.phase !== "compare" || state.draftComparison === null) return false;
    const before = rankedPrograms();
    const beforeTop = before.slice(0, 3).map((item) => programKey(item.profile.program));
    const hypothetical = state.comparisons.concat({
      left: state.currentPair.left,
      right: state.currentPair.right,
      value: Number(state.draftComparison),
    });
    const current = state.comparisons;
    state.comparisons = hypothetical;
    const after = rankedPrograms();
    state.comparisons = current;
    const afterTop = after.slice(0, 3).map((item) => programKey(item.profile.program));
    const separation = after.length > 3 ? after[2].score - after[3].score : Infinity;
    return hypothetical.length >= MAX_COMPARISONS
      || (hypothetical.length >= 2 && beforeTop.length === afterTop.length && beforeTop.every((key) => afterTop.includes(key)) && separation >= 3.5);
  }

  function restart() {
    state = freshState();
    elements.results.hidden = true;
    elements.panel.hidden = false;
    elements.feedback.textContent = "";
    renderQuestion();
    document.getElementById("testExperience").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function preferenceWeights() {
    const weights = new Map();
    for (const code of state.interests) if (code !== UNKNOWN) weights.set(code, 1);
    for (const choice of state.comparisons) {
      const delta = choice.value * .45;
      weights.set(choice.left, (weights.get(choice.left) || 0) + delta);
      weights.set(choice.right, (weights.get(choice.right) || 0) - delta);
    }
    return weights;
  }

  function normalizedCategoryShare(profile, code) {
    const maximum = profile.maxCategoryShares.get(code) || 0;
    return maximum > 0 ? (profile.categoryShares.get(code) || 0) / maximum : 0;
  }

  function fitFor(profile, preferences) {
    const positives = [...preferences.entries()].filter(([, weight]) => weight > .04);
    const preferenceTotal = positives.reduce((sum, [, weight]) => sum + weight, 0);
    const subjectFit = preferenceTotal
      ? positives.reduce((sum, [code, weight]) => sum + weight * normalizedCategoryShare(profile, code), 0) / preferenceTotal
      : 0;
    const activityShare = state.activity ? profile.activityShares[state.activity] : null;
    const activityMax = state.activity ? profile.maxActivityShares[state.activity] || 0 : 0;
    const activityFit = activityShare !== null && activityShare !== undefined && activityMax > 0 ? activityShare / activityMax : null;
    const blend = activityFit === null ? subjectFit : subjectFit * .82 + activityFit * .18;
    const avoidCodes = state.avoid.filter((code) => code !== NO_AVOID);
    const antiFit = avoidCodes.length
      ? avoidCodes.reduce((sum, code) => sum + normalizedCategoryShare(profile, code), 0) / avoidCodes.length
      : 0;
    return {
      score: Math.max(0, Math.min(100, blend * 100 - antiFit * 12)),
      subjectFit,
      activityFit,
      antiFit,
      positives,
    };
  }

  function rankedPrograms() {
    const preferences = preferenceWeights();
    return profiles.map((profile) => ({ profile, ...fitFor(profile, preferences) }))
      .sort((a, b) => b.score - a.score || text(a.profile.program.code).localeCompare(text(b.profile.program.code), "ru"));
  }

  function selectAdaptivePair() {
    if (categories.length < 2 || profiles.length < 2) return null;
    const used = new Set(state.comparisons.flatMap((item) => [item.left, item.right]));
    const available = categories.filter((category) => !used.has(category.code));
    if (available.length < 2) return null;
    const leaders = rankedPrograms().slice(0, 12).map((item) => item.profile);
    let best = null;
    for (let i = 0; i < available.length; i += 1) {
      for (let j = i + 1; j < available.length; j += 1) {
        const left = available[i];
        const right = available[j];
        const values = leaders.map((profile) => (profile.categoryShares.get(left.code) || 0) - (profile.categoryShares.get(right.code) || 0));
        const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
        const score = Math.sqrt(variance) + Math.abs(mean) * .1;
        if (!best || score > best.score) best = { left: left.code, right: right.code, score };
      }
    }
    if (!best) return null;
    return best;
  }

  function renderResults() {
    const ranked = rankedPrograms();
    const main = ranked.slice(0, 3);
    const alternatives = ranked.slice(3, 5);
    elements.mainRecommendations.replaceChildren();
    elements.alternativeRecommendations.replaceChildren();
    elements.resultsCount.textContent = Andromeda.formatNumber(ranked.length);
    elements.resultsSummary.textContent = `Ответов: ${3 + state.comparisons.length}. Совпадение рассчитано по реальным предметным категориям и распределению часов в учебных планах.`;
    elements.resultsMethod.textContent = "Индекс — относительное сопоставление программ внутри каталога: доли часов по выбранным категориям, формат занятий и штраф за явно нежелательные области. Это не процент вероятности поступления. Программы без классифицированных часов не ранжировались.";
    main.forEach((item, index) => elements.mainRecommendations.append(renderRecommendation(item, index + 1, false)));
    alternatives.forEach((item, index) => elements.alternativeRecommendations.append(renderRecommendation(item, index + 4, true)));
    elements.alternativeSection.hidden = alternatives.length === 0;
    const missingPrograms = Math.max(0, programs.length - ranked.length);
    const rowsLabel = Andromeda.numberPlural(totalCurriculumRows, ["строка учебного плана", "строки учебного плана", "строк учебного плана"]);
    const sourceLabel = dataSource === "api" ? "активного API каталога" : dataSource === "api-current" ? "выпуска, сверенного с API" : "резервного снимка базы";
    let note = `В подборе учтены ${Andromeda.formatNumber(ranked.length)} программ с планами и классифицированными часами из ${Andromeda.formatNumber(programs.length)} программ каталога. Загружено ${Andromeda.formatNumber(totalCurriculumRows)} ${rowsLabel}; категории указаны у ${Andromeda.formatNumber(classifiedRows)} строк.`;
    if (missingPrograms) note += ` Для ${Andromeda.formatNumber(missingPrograms)} программ данных недостаточно, поэтому их нельзя честно ранжировать.`;
    if (failedPlans) note += ` Не удалось загрузить учебные планы для ${Andromeda.formatNumber(failedPlans)} профилей.`;
    note += ` Источник: ${sourceLabel}.`;
    elements.resultsDataNote.textContent = note;
  }

  function renderRecommendation(item, rank, alternative) {
    const { profile, score } = item;
    const program = profile.program;
    const key = programKey(program);
    const card = document.createElement("article");
    card.className = `recommendation-card${rank === 1 ? " is-featured" : ""}`;
    const top = document.createElement("div");
    top.className = "recommendation-top";
    add(top, "span", "recommendation-rank", alternative ? `АЛЬТЕРНАТИВА ${rank - 3}` : `ВАРИАНТ ${String(rank).padStart(2, "0")}`);
    add(top, "span", "recommendation-code", program.code || "Код не указан");
    card.append(top);
    add(card, "h3", "", program.name || "Образовательная программа");
    add(card, "p", "recommendation-direction", [program.direction_code, program.direction].filter(Boolean).join(" · ") || "Направление не указано");

    const scoreBox = document.createElement("div");
    scoreBox.className = "fit-index";
    const scoreTop = document.createElement("div");
    scoreTop.className = "fit-index-top";
    add(scoreTop, "span", "", "Совпадение с ответами");
    add(scoreTop, "strong", "", `${Math.round(score)} / 100`);
    scoreBox.append(scoreTop);
    const track = document.createElement("div");
    track.className = "fit-index-track";
    const fill = document.createElement("span");
    fill.style.setProperty("--fit-width", `${Math.max(0, Math.min(100, score))}%`);
    track.append(fill);
    scoreBox.append(track);
    add(scoreBox, "span", "fit-index-caption", "Относительный индекс по программам каталога, не шанс поступления");
    card.append(scoreBox);

    const preferences = preferenceWeights();
    const matched = [...preferences.entries()]
      .filter(([, weight]) => weight > .04)
      .map(([code, weight]) => ({ code, weight, share: profile.categoryShares.get(code) || 0, contribution: weight * normalizedCategoryShare(profile, code) }))
      .filter((entry) => entry.share > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);
    if (matched.length) {
      const reason = document.createElement("section");
      reason.className = "recommendation-reasons";
      add(reason, "h4", "", "Ближе всего по содержанию");
      const chips = document.createElement("div");
      chips.className = "reason-chip-list";
      for (const entry of matched) {
        const category = categoryByCode(entry.code);
        const chip = add(chips, "span", "reason-chip", category ? category.name : `Категория ${entry.code}`);
        add(chip, "strong", "", percent(entry.share));
      }
      reason.append(chips);
      card.append(reason);
    }
    const avoid = state.avoid.filter((code) => code !== NO_AVOID)
      .map((code) => ({ code, share: profile.categoryShares.get(code) || 0 }))
      .filter((entry) => entry.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, 2);
    if (avoid.length) {
      const reason = document.createElement("section");
      reason.className = "recommendation-reasons";
      add(reason, "h4", "", "Проверь нежелательные темы");
      const chips = document.createElement("div");
      chips.className = "reason-chip-list";
      for (const entry of avoid) {
        const category = categoryByCode(entry.code);
        const chip = add(chips, "span", "reason-chip avoid", category ? category.name : `Категория ${entry.code}`);
        add(chip, "strong", "", percent(entry.share));
      }
      reason.append(chips);
      card.append(reason);
    }
    const coverage = profile.totalHours > 0 ? profile.classifiedHours / profile.totalHours : 0;
    const plan = document.createElement("div");
    plan.className = "recommendation-data";
    add(plan, "strong", "", `${Andromeda.formatNumber(profile.totalHours)} ч`);
    plan.append(document.createTextNode(" в учебном плане · классифицировано "));
    add(plan, "strong", "", percent(coverage));
    plan.append(document.createTextNode(" указанных часов"));
    if (item.activityFit !== null && state.activity) {
      const activity = activityOptions.find((option) => option.key === state.activity);
      plan.append(document.createElement("br"));
      plan.append(document.createTextNode(`${activity?.title || "Выбранный формат"}: ${percent(profile.activityShares[state.activity])} распределённых часов`));
    }
    const planSource = Andromeda.safeUrl(profile.plan?.document_url || profile.plan?.study_plan_url || profile.plan?.download_url || "");
    if (planSource) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "source-link";
      sourceLink.href = planSource;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = "Оригинал учебного плана ↗";
      plan.append(document.createElement("br"), sourceLink);
    }
    card.append(plan);
    card.append(renderAdmissionFit(program));

    const actions = document.createElement("div");
    actions.className = "recommendation-actions";
    const open = document.createElement("a");
    open.className = "button button-secondary";
    open.href = `programs.html?code=${encodeURIComponent(program.code || "")}`;
    open.textContent = "Учебный план";
    actions.append(open);
    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "button button-secondary compare-toggle";
    compare.dataset.programKey = key;
    compare.addEventListener("click", () => toggleCompare(compare, key));
    actions.append(compare);
    card.append(actions);
    updateCompareButton(compare);
    return card;
  }

  async function toggleCompare(button, key) {
    const current = Andromeda.getComparison();
    const selected = current.includes(key);
    if (!selected && current.length >= 3) {
      if (await Andromeda.askClearComparison()) {
        Andromeda.setComparison([]);
        elements.resultsDataNote.textContent = "Список сравнения очищен. Нажми «В сравнение» ещё раз, чтобы добавить эту программу.";
        document.querySelectorAll(".compare-toggle").forEach(updateCompareButton);
      }
      return;
    }
    Andromeda.toggleComparison(key, !selected);
    document.querySelectorAll(".compare-toggle").forEach(updateCompareButton);
  }

  function updateCompareButton(button) {
    const selected = Andromeda.getComparison().includes(button.dataset.programKey);
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = selected ? "Добавлено ✓" : "В сравнение";
  }

  function renderAdmissionFit(program) {
    const box = document.createElement("section");
    box.className = "admission-fit";
    const directionCode = text(program.direction_code);
    const requirements = (admission?.requirements || []).filter((row) => row.direction_code === directionCode);
    const profile = Andromeda.getProfile();
    const hasScores = Object.values(profile.scores || {}).some((value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value)));
    if (!admissionReady) {
      add(box, "strong", "", "Поступление · загружаем условия");
      add(box, "span", "", "Проверка баллов не влияет на подбор и не является прогнозом зачисления.");
    } else if (!requirements.length) {
      add(box, "strong", "", "Поступление · недостаточно данных");
      add(box, "span", "", "Для направления не нашлись опубликованные минимумы в подключённом архиве.");
    } else if (!hasScores) {
      add(box, "strong", "", "Поступление · баллы не добавлены");
      add(box, "span", "", `${requirements.length} набора опубликованных условий. Тест не запрашивает баллы повторно и не оценивает шанс зачисления.`);
    } else {
      const states = requirements.map((row) => evaluateRequirement(row.requirement_tree, profile.scores));
      const label = states.every((value) => value === true)
        ? "Показанные минимумы пройдены"
        : states.some((value) => value === true)
          ? "Один из наборов минимумов пройден"
          : states.every((value) => value === false)
            ? "Показанные минимумы не пройдены"
            : "Недостаточно баллов для сверки";
      add(box, "strong", "", `Поступление · ${label}`);
      add(box, "span", "", "Проверка опубликованных минимумов отдельно от подбора. Выполнение минимума не гарантирует зачисление.");
    }
    const link = document.createElement("a");
    link.href = `admission.html?direction=${encodeURIComponent(directionCode)}`;
    link.textContent = "Все условия направления ↗";
    box.append(link);
    return box;
  }

  function evaluateRequirement(node, scores) {
    if (!node) return null;
    const exam = node.exam || (node.subject_code ? node : null);
    if (exam) {
      const rawScore = scores[exam.subject_code];
      const score = rawScore === "" || rawScore == null ? null : Number(rawScore);
      const minimum = number(exam.minimum_score);
      if (!Number.isFinite(score) || minimum === null) return null;
      return score >= minimum;
    }
    const children = Array.isArray(node.children) ? node.children.map((child) => evaluateRequirement(child, scores)) : [];
    if (!children.length) return null;
    const operator = text(node.operator).toUpperCase();
    if (operator === "AND") {
      if (children.includes(false)) return false;
      return children.every((value) => value === true) ? true : null;
    }
    const required = operator === "AT_LEAST" ? Math.max(1, Number(node.min_count ?? node.threshold) || 1) : 1;
    const yes = children.filter((value) => value === true).length;
    const unknown = children.filter((value) => value === null).length;
    if (yes >= required) return true;
    if (yes + unknown < required) return false;
    return null;
  }

  function showResults() {
    state.phase = "results";
    elements.panel.hidden = true;
    elements.results.hidden = false;
    renderResults();
    elements.results.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function taxonomyCategory(category) {
    return {
      code: text(category.category_code || category.code),
      name: text(category.name || category.category_name),
      definition: text(category.definition),
      ordinal: number(category.ordinal) || 0,
    };
  }

  function buildProgramProfiles(curriculum) {
    const rowsByKey = new Map();
    for (const row of curriculum.data) {
      for (const key of [text(row.program_key), text(row.program_code)]) {
        if (!key) continue;
        if (!rowsByKey.has(key)) rowsByKey.set(key, []);
        rowsByKey.get(key).push(row);
      }
    }
    const plansByKey = new Map();
    for (const plan of curriculum.plans || []) {
      const key = text(plan.program_key);
      if (key) plansByKey.set(key, plan);
    }
    totalCurriculumRows = curriculum.data.length;
    classifiedRows = 0;
    const built = [];
    for (const program of programs) {
      const key = programKey(program);
      const rows = rowsByKey.get(key) || rowsByKey.get(text(program.code)) || [];
      const categoryHours = new Map();
      let classifiedHours = 0;
      let totalHours = 0;
      let lecture = 0;
      let practice = 0;
      let lab = 0;
      let independent = 0;
      const knownActivity = new Set();
      for (const row of rows) {
        const hours = number(row.hours);
        if (hours !== null && hours > 0) totalHours += hours;
        const classification = row.subject_classification || row.subjectClassification;
        const code = text(classification?.category_code);
        if (code && categories.some((category) => category.code === code) && hours !== null && hours > 0) {
          categoryHours.set(code, (categoryHours.get(code) || 0) + hours);
          classifiedHours += hours;
          classifiedRows += 1;
        }
        for (const [field, bucket] of [["lecture_hours", "lecture"], ["practice_hours", "practice"], ["lab_hours", "lab"], ["self_study_hours", "independent"]]) {
          const value = number(row[field]);
          if (value === null || value < 0) continue;
          knownActivity.add(bucket);
          if (bucket === "lecture") lecture += value;
          if (bucket === "practice") practice += value;
          if (bucket === "lab") lab += value;
          if (bucket === "independent") independent += value;
        }
      }
      if (!classifiedHours) continue;
      const activityDenominator = lecture + practice + lab + independent;
      const categoryShares = new Map([...categoryHours.entries()].map(([code, value]) => [code, value / classifiedHours]));
      const activityShares = {};
      if (activityDenominator > 0) {
        if (knownActivity.has("lecture")) activityShares.lecture_hours = lecture / activityDenominator;
        if (knownActivity.has("practice")) activityShares.practice_hours = practice / activityDenominator;
        if (knownActivity.has("lab")) activityShares.lab_hours = lab / activityDenominator;
        if (knownActivity.has("independent")) activityShares.self_study_hours = independent / activityDenominator;
      }
      built.push({
        program,
        rows,
        plan: plansByKey.get(key) || null,
        totalHours,
        classifiedHours,
        categoryHours,
        categoryShares,
        activityShares,
      });
    }
    return setProfileMaxima(built);
  }

  function setProfileMaxima(built) {
    const maxCategoryShares = new Map();
    const maxActivityShares = {};
    for (const profile of built) {
      for (const [code, value] of profile.categoryShares) maxCategoryShares.set(code, Math.max(maxCategoryShares.get(code) || 0, value));
      for (const [key, value] of Object.entries(profile.activityShares)) maxActivityShares[key] = Math.max(maxActivityShares[key] || 0, value);
    }
    for (const profile of built) {
      profile.maxCategoryShares = maxCategoryShares;
      profile.maxActivityShares = maxActivityShares;
    }
    return built;
  }

  function restoreProgramProfiles(snapshot) {
    const byKey = new Map(programs.flatMap((program) => [[programKey(program), program], [text(program.code), program]]).filter(([key]) => key));
    const restored = (snapshot.profiles || []).map((item) => {
      const program = byKey.get(text(item.program_key)) || byKey.get(text(item.code));
      if (!program) return null;
      const categoryHours = new Map(Object.entries(item.category_hours || {}).map(([code, value]) => [code, number(value) || 0]));
      const classifiedHours = number(item.classified_hours) || 0;
      if (!classifiedHours) return null;
      const categoryShares = new Map([...categoryHours.entries()].map(([code, value]) => [code, value / classifiedHours]));
      const profilePlan = {
        external_key: item.plan_key,
        academic_year: item.academic_year,
        document_url: item.plan_source_url,
        total_academic_hours: item.total_hours,
      };
      return {
        program,
        rows: [],
        plan: profilePlan,
        totalHours: number(item.total_hours) || 0,
        classifiedHours,
        categoryHours,
        categoryShares,
        activityShares: item.activity_shares || {},
      };
    }).filter(Boolean);
    return setProfileMaxima(restored);
  }

  async function readProfileSnapshot() {
    try {
      const response = await fetch("data/prof-test-profiles.json", { cache: "no-cache" });
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }

  async function loadTaxonomy(rows) {
    const classification = rows.map((row) => row.subject_classification || row.subjectClassification)
      .find((item) => item?.taxonomy_key && item?.taxonomy_version);
    const key = classification?.taxonomy_key || "bmstu-subject-domain-16";
    const version = classification?.taxonomy_version || "v1";
    try {
      const taxonomy = await window.AcademicData.get(`/v1/subject-taxonomies/${encodeURIComponent(key)}/${encodeURIComponent(version)}`);
      return Array.isArray(taxonomy.categories) ? taxonomy.categories.map(taxonomyCategory).filter((item) => item.code && item.name).sort((a, b) => a.ordinal - b.ordinal) : [];
    } catch {
      const found = new Map();
      for (const row of rows) {
        const item = row.subject_classification || row.subjectClassification;
        const code = text(item?.category_code);
        const name = text(item?.category_name);
        if (code && name) found.set(code, { code, name, definition: "Предметная область из классификатора учебного плана.", ordinal: Number(code) || 0 });
      }
      return [...found.values()].sort((a, b) => a.ordinal - b.ordinal);
    }
  }

  async function loadAdmissionRequirements() {
    const api = window.AcademicData;
    if (api?.getProgramDataSource?.() === "live") {
      try {
        const campaigns = await api.list("/v1/campaigns", { year: 2026 });
        const campaign = campaigns.find((item) => Number(item.year) === 2026 && item.campaign_kind === "admission") || campaigns[0];
        if (!campaign?.external_key) throw new Error("Admission campaign not found");
        const rows = await api.list("/v1/requirements", { campaign_key: campaign.external_key });
        if (rows.length) return { requirements: rows.map((row) => ({ ...row, requirement_tree: row.root })) };
      } catch {
        // Fall through to the bundled archive if the requirements endpoint is unavailable.
      }
    }
    try { return (await Andromeda.loadAdmission()).data; }
    catch { return null; }
  }

  async function initialize() {
    try {
      const programResult = await Andromeda.loadPrograms();
      programs = programResult.data;
      const demoMode = window.AcademicData.isDemoMode?.() === true;
      const snapshot = demoMode ? await readProfileSnapshot() : null;
      if (demoMode && snapshot) {
        categories = (snapshot.taxonomy?.categories || []).map(taxonomyCategory).filter((item) => item.code && item.name).sort((a, b) => a.ordinal - b.ordinal);
        profiles = restoreProgramProfiles(snapshot);
        dataSource = "demo";
        totalCurriculumRows = number(snapshot.curriculum_item_count) || 0;
        classifiedRows = number(snapshot.classified_row_count) || 0;
        failedPlans = number(snapshot.failed_plan_count) || (Array.isArray(snapshot.failed_plans) ? snapshot.failed_plans.length : 0);
      } else {
        const current = await Andromeda.loadCurriculumForPrograms(programs.map(programKey));
        dataSource = current.source === "api" ? "api" : "demo";
        failedPlans = Number(current.failedPlans) || 0;
        categories = await loadTaxonomy(current.data);
        profiles = buildProgramProfiles(current);
      }
      if (categories.length < 2) throw new Error("Не загрузился перечень предметных областей классификатора.");
      if (!profiles.length) throw new Error("В доступных планах пока нет размеченных часов, достаточных для честного сопоставления.");
      if (dataSource === "api") {
        elements.sourceNote.textContent = `Данные поступают из текущего API каталога: ${profiles.length} программ имеют классифицированные часы. План без предметной классификации не получает искусственную оценку.`;
      } else {
        const savedAt = snapshot?.fetched_at ? Andromeda.formatSnapshotDate(snapshot.fetched_at) : "";
        elements.sourceNote.textContent = `Демо-снимок${savedAt ? ` от ${savedAt}` : ""}: ${profiles.length} программ с классифицированными часами. Сравнение основано на составе планов из локальных JSON.`;
      }
      elements.loading.hidden = true;
      elements.panel.hidden = false;
      renderQuestion();
      admissionPromise = loadAdmissionRequirements().then((result) => {
        admission = result;
        admissionReady = true;
        if (state.phase === "results") renderResults();
      }).catch(() => {
        admission = null;
        admissionReady = true;
        if (state.phase === "results") renderResults();
      });
    } catch (error) {
      elements.loading.hidden = true;
      elements.unavailable.hidden = false;
      elements.unavailable.textContent = `${text(error?.message) || "Не удалось загрузить учебные планы."} Проверь доступность API каталога и открой проф-тест позже.`;
    }
  }

  document.getElementById("nextQuestion").addEventListener("click", continueQuestion);
  document.getElementById("previousQuestion").addEventListener("click", previousQuestion);
  document.getElementById("restartTest").addEventListener("click", restart);
  document.getElementById("restartFromResults").addEventListener("click", restart);
  document.getElementById("editTest").addEventListener("click", previousQuestion);
  initialize();
})();
