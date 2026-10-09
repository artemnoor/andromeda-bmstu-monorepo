(() => {
  const $ = selector => document.querySelector(selector);
  const view = $("#workspaceView");
  const title = $("#viewTitle");
  const description = $("#viewDescription");
  const sourceStatus = $("#sourceStatus");
  const favoriteCount = $("#favoriteCount");
  const dialog = $("#programDialog");
  const dialogBody = $("#dialogBody");
  const profileStorageKey = "andromeda.applicant.v1";
  const favoritesStorageKey = "andromeda.favorites.v1";
  const compareStorageKey = "andromeda.compare.v1";
  const data = window.AcademicData;
  const routeDetails = {
    recommend: ["Проф-тест", "Подберём программы по вашим интересам и реальным часам учебных планов."],
    compare: ["Сравнить программы", "Сопоставьте кафедры, длительность обучения и реальные дисциплины учебных планов по семестрам."],
    admission: ["Проверить поступление", "Сравните свои баллы с опубликованными минимумами, изучите конкурсные места и условия учёта достижений."],
    catalog: ["Каталог программ", "152 профиля бакалавриата и специалитета МГТУ: поиск по коду, направлению и кафедре."],
    favorites: ["Избранное", "Сохранённые программы хранятся в этом браузере и доступны без регистрации."],
    profile: ["Профиль абитуриента", "Запишите баллы ЕГЭ, интересы и личные достижения — данные останутся в вашем браузере."]
  };
  const state = {
    route: "recommend",
    renderToken: 0,
    programs: [],
    directions: [],
    departments: [],
    campaign: null,
    requirements: null,
    achievements: null,
    pools: null,
    offerings: null,
    profile: readProfile(),
    compareBundles: [],
    compareSemester: 1,
    bundleCache: new Map(),
    dialogToken: 0
  };

  function readProfile() {
    try {
      const value = typeof window.AndromedaBrowserState?.readProfile === "function"
        ? window.AndromedaBrowserState.readProfile()
        : JSON.parse(localStorage.getItem(profileStorageKey) || "{}");
      return {
        scores: value.scores && typeof value.scores === "object" ? value.scores : {},
        interests: Array.isArray(value.interests) ? value.interests : [],
        achievementKeys: Array.isArray(value.achievements) ? value.achievements : Array.isArray(value.achievementKeys) ? value.achievementKeys : [],
        directionCode: typeof value.targetDirection === "string" ? value.targetDirection : typeof value.directionCode === "string" ? value.directionCode : ""
      };
    } catch {
      return { scores: {}, interests: [], achievementKeys: [], directionCode: "" };
    }
  }

  function saveProfile() {
    const value = {
      scores: state.profile.scores,
      interests: state.profile.interests,
      achievements: state.profile.achievementKeys,
      targetDirection: state.profile.directionCode
    };
    try {
      if (typeof window.AndromedaBrowserState?.writeProfile === "function") {
        window.AndromedaBrowserState.writeProfile(value);
      } else {
        localStorage.setItem(profileStorageKey, JSON.stringify(value));
      }
    } catch { /* Private browsing may disable storage. */ }
  }

  function readKeyList(key) {
    try {
      if (typeof window.AndromedaBrowserState?.readList === "function") {
        return window.AndromedaBrowserState.readList(key);
      }
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
    } catch { return []; }
  }

  function writeKeyList(key, values) {
    const unique = [...new Set(values.filter(item => typeof item === "string"))]
      .slice(0, key === compareStorageKey ? 3 : 20);
    try {
      if (typeof window.AndromedaBrowserState?.writeList === "function") {
        const stored = window.AndromedaBrowserState.writeList(key, unique);
        if (Array.isArray(stored)) return stored;
      } else {
        localStorage.setItem(key, JSON.stringify(unique));
      }
    } catch { /* Keep the current page usable if storage is full. */ }
    return unique;
  }

  const text = value => typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const money = value => {
    const parsed = number(value);
    return parsed === null ? "Не указано" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(parsed) + " ₽";
  };
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  };

  function node(tag, className, value) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined && value !== null) item.textContent = text(value);
    return item;
  }

  function action(label, onClick, className = "button") {
    const button = node("button", className, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function externalLink(label, href) {
    const url = safeUrl(href);
    if (!url) return null;
    const link = node("a", "text-action", label);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function setSourceState(stateName, message) {
    sourceStatus.dataset.state = stateName;
    sourceStatus.lastElementChild.textContent = message;
  }

  window.addEventListener("academic-data-source", event => {
    if (event.detail?.source === "live") {
      setSourceState("live", `Активный API каталога · ${event.detail.count} программ`);
    } else if (event.detail?.source === "demo") {
      setSourceState("snapshot", `ДЕМО-снимок · ${event.detail.count} программ`);
    }
  });

  function directionFor(program) {
    const direction = state.directions.find(item => item.external_key === program.direction_key);
    return {
      key: program.direction_key || "",
      code: text(direction?.code || program.direction_code),
      name: text(direction?.name || program.direction)
    };
  }

  function departmentsFor(program) {
    const relations = Array.isArray(program.department_relations) ? program.department_relations : [];
    const fromApi = relations.map(relation => {
      const department = state.departments.find(item => item.external_key === relation.department_key);
      return department ? { key: department.external_key, code: text(department.code), name: text(department.name), status: relation.verification_status } : null;
    }).filter(Boolean);
    if (fromApi.length) return fromApi;
    return text(program.department_code || program.department)
      ? [{ key: "", code: text(program.department_code), name: text(program.department), status: "" }]
      : [];
  }

  function programKey(program) {
    return text(program.external_key || program.program_key)
      || (text(program.code) ? `snapshot:program:${text(program.code)}` : "");
  }
  function programLabel(program) {
    const direction = directionFor(program);
    const department = departmentsFor(program)[0];
    const prefix = [direction.code, department?.code].filter(Boolean).join(" · ");
    return `${prefix ? `${prefix} · ` : ""}${text(program.name)}`;
  }

  function selectedProgram(key) { return state.programs.find(program => programKey(program) === key); }
  function setFavoriteCount() {
    if (!favoriteCount) return;
    const count = readKeyList(favoritesStorageKey).length;
    favoriteCount.hidden = count === 0;
    favoriteCount.textContent = String(count);
  }

  function isFavorite(key) { return readKeyList(favoritesStorageKey).includes(key); }
  function toggleFavorite(key) {
    const current = readKeyList(favoritesStorageKey);
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    writeKeyList(favoritesStorageKey, next);
    setFavoriteCount();
    return next.includes(key);
  }

  function addToCompare(key) {
    const current = readKeyList(compareStorageKey);
    if (current.includes(key)) return current;
    const next = current.length >= 3 ? [...current.slice(1), key] : [...current, key];
    return writeKeyList(compareStorageKey, next);
  }

  function makeFavoriteButton(key) {
    const button = node("button", "icon-button", isFavorite(key) ? "★" : "☆");
    button.type = "button";
    button.title = isFavorite(key) ? "Убрать из избранного" : "Сохранить в избранное";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(isFavorite(key)));
    button.addEventListener("click", () => {
      const added = toggleFavorite(key);
      button.textContent = added ? "★" : "☆";
      button.title = added ? "Убрать из избранного" : "Сохранить в избранное";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(added));
      if (state.route === "favorites") renderRoute();
    });
    return button;
  }

  function chip(label) { return node("span", "data-chip", label); }

  function programMeta(program) {
    const direction = directionFor(program);
    const departments = departmentsFor(program);
    return [direction.name, ...departments.map(item => [item.code, item.name].filter(Boolean).join(" · "))].filter(Boolean);
  }

  function makeProgramResult(program, matchReasons = []) {
    const card = node("article", "program-result");
    const content = node("div");
    const code = node("span", "program-code", text(program.code) || "Профиль МГТУ");
    content.append(code, node("h3", "", text(program.name)));
    const summary = node("p", "", text(program.description) || "Официальное описание профиля в каталоге не опубликовано.");
    content.append(summary);
    const meta = node("div", "program-meta");
    for (const item of programMeta(program).slice(0, 3)) meta.append(chip(item));
    for (const item of matchReasons) meta.append(chip(`Совпадение: ${item}`));
    content.append(meta);

    const actions = node("div", "program-result-actions");
    const compare = action("Сравнить", () => {
      addToCompare(programKey(program));
      window.location.hash = "compare";
    }, "button quiet");
    actions.append(makeFavoriteButton(programKey(program)), compare);
    card.append(content, actions);
    return card;
  }

  function makeCatalogCard(program) {
    const card = node("article", "catalog-card");
    const top = node("div", "catalog-card-top");
    top.append(node("span", "program-code", text(program.code) || "Профиль МГТУ"), makeFavoriteButton(programKey(program)));
    const copy = node("div");
    copy.append(node("h3", "", text(program.name)));
    const summary = text(program.description);
    if (summary) copy.append(node("p", "", summary));
    const meta = node("div", "program-meta");
    for (const item of programMeta(program).slice(0, 3)) meta.append(chip(item));
    copy.append(meta);

    const bottom = node("div", "catalog-card-bottom");
    const details = action("Карточка программы", () => openProgram(programKey(program)), "text-action");
    const compare = action("Сравнить", () => {
      addToCompare(programKey(program));
      window.location.hash = "compare";
    }, "text-action");
    bottom.append(details, compare);
    const source = externalLink("Источник ↗", program.sources?.[0]?.source_url || program.source_url || program.catalog_page_url);
    if (source) bottom.append(source);
    card.append(top, copy, bottom);
    return card;
  }

  async function loadBaseData() {
    const results = await Promise.allSettled([
      data.programs(),
      data.list("/v1/directions"),
      data.list("/v1/departments"),
      data.list("/v1/campaigns", { year: 2026 })
    ]);
    if (results[0].status === "fulfilled") state.programs = results[0].value;
    if (results[1].status === "fulfilled") state.directions = results[1].value;
    if (results[2].status === "fulfilled") state.departments = results[2].value;
    if (results[3].status === "fulfilled") state.campaign = results[3].value[0] || null;

    if (!state.programs.length) throw results[0].reason || new Error("Каталог программ пока недоступен.");
    if (!state.campaign) state.campaign = { external_key: "campaign:bmstu:2026", year: 2026 };
  }

  function setIntro(route) {
    const [heading, subheading] = routeDetails[route] || routeDetails.recommend;
    title.textContent = heading;
    description.textContent = subheading;
    document.title = `${heading} — Andromeda × BMSTU`;
    document.querySelectorAll(".workspace-tab[data-route]").forEach(tab => {
      if (tab.dataset.route === route) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  }

  async function renderRoute() {
    const route = location.hash.slice(1).split("?")[0] || "recommend";
    state.route = Object.hasOwn(routeDetails, route) ? route : "recommend";
    const token = ++state.renderToken;
    setIntro(state.route);
    setFavoriteCount();
    view.replaceChildren();
    const loading = node("div", "loading-panel");
    loading.append(node("span", "loader"), node("p", "", "Подготавливаем раздел…"));
    view.append(loading);

    try {
      if (!state.programs.length) await loadBaseData();
      if (token !== state.renderToken) return;
      const renderers = {
        recommend: renderRecommend,
        compare: renderCompare,
        admission: renderAdmission,
        catalog: renderCatalog,
        favorites: renderFavorites,
        profile: renderProfile
      };
      view.replaceChildren();
      await renderers[state.route](view, token);
    } catch (error) {
      if (token !== state.renderToken) return;
      setSourceState("error", "Источник данных временно недоступен");
      view.replaceChildren(errorPanel(error.message || "Не удалось загрузить этот раздел."));
    }
  }

  function errorPanel(message) {
    const panel = node("section", "error-panel");
    panel.append(node("h2", "", "Не получилось загрузить данные"), node("p", "", `${message} Проверьте подключение и попробуйте ещё раз.`));
    panel.append(action("Повторить", () => renderRoute(), "button secondary"));
    return panel;
  }

  window.addEventListener("hashchange", renderRoute);
  $("#dialogClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  const interestGroups = [
    { id: "software", label: "Программирование", terms: ["программ", "информат", "код", "алгоритм", "компьютер", "вычисл", "данн", "кибер"] },
    { id: "math", label: "Математика", terms: ["математ", "числен", "моделирован", "анализ", "статист", "оптимальн"] },
    { id: "physics", label: "Физика и электроника", terms: ["физик", "электрон", "электр", "радио", "лазер", "оптик", "плазм", "ядер"] },
    { id: "robotics", label: "Робототехника", terms: ["робот", "мехатрон", "автоматизац", "управлен", "механик", "машин"] },
    { id: "space", label: "Космос и авиация", terms: ["космич", "ракет", "летатель", "авиац", "навигац", "баллист", "двигател"] },
    { id: "biotech", label: "Биотехнологии", terms: ["биотех", "биолог", "медицин", "жизнеобеспеч", "биосистем", "технологи"] },
    { id: "design", label: "Конструирование и дизайн", terms: ["дизайн", "конструирован", "проектирован", "архитектур", "материал", "прибор"] },
    { id: "business", label: "Экономика и управление", terms: ["эконом", "менедж", "бизнес", "предприним", "финанс", "инноват"] }
  ];

  function addPanelHeading(panel, heading, note) {
    const head = node("header", "panel-heading");
    const copy = node("div");
    copy.append(node("h2", "", heading));
    if (note) copy.append(node("p", "", note));
    head.append(copy);
    panel.append(head);
    return head;
  }

  function interestChoices(container, selected, onChange, groupName = "interests") {
    container.className = "interest-grid";
    for (const interest of interestGroups) {
      const wrap = node("div", "choice-pill");
      const input = node("input");
      input.type = "checkbox";
      input.id = `${groupName}-${interest.id}`;
      input.name = groupName;
      input.value = interest.id;
      input.checked = selected.includes(interest.id);
      const label = node("label", "", interest.label);
      label.htmlFor = input.id;
      input.addEventListener("change", () => {
        const values = [...container.querySelectorAll("input:checked")].map(item => item.value);
        onChange(values);
      });
      wrap.append(input, label);
      container.append(wrap);
    }
  }

  function programSearchText(program) {
    return [
      program.name, program.description, directionFor(program).name,
      directionFor(program).code, ...programMeta(program),
      ...(Array.isArray(program.catalog_course_names) ? program.catalog_course_names : [])
    ].join(" ").toLocaleLowerCase("ru-RU");
  }

  function scoreByInterests(program, selected) {
    const searchable = programSearchText(program);
    return interestGroups.filter(group => selected.includes(group.id) && group.terms.some(term => searchable.includes(term)));
  }

  function makeRecommendations(container, selected) {
    container.replaceChildren();
    if (!selected.length) {
      const empty = node("div", "empty-state");
      empty.append(node("h2", "", "Выберите, что вам интересно"), node("p", "", "Подборка сопоставит ваши темы с описаниями профилей и названиями дисциплин, опубликованными в каталоге МГТУ."));
      container.append(empty);
      return;
    }

    const ranked = state.programs.map(program => ({ program, matches: scoreByInterests(program, selected) }))
      .filter(item => item.matches.length)
      .sort((a, b) => b.matches.length - a.matches.length || text(a.program.name).localeCompare(text(b.program.name), "ru"))
      .slice(0, 8);

    if (!ranked.length) {
      const empty = node("div", "empty-state");
      empty.append(node("h2", "", "По этим темам точных совпадений не найдено"), node("p", "", "Попробуйте отметить несколько других направлений интереса или воспользуйтесь каталогом."));
      const link = node("a", "button secondary", "Открыть каталог");
      link.href = "#catalog";
      empty.append(link);
      container.append(empty);
      return;
    }

    const resultHead = node("div", "panel-heading");
    resultHead.append(node("div", "", `${ranked.length} подходящих профилей`));
    container.append(resultHead);
    for (const item of ranked) container.append(makeProgramResult(item.program, item.matches.map(match => match.label)));
  }

  async function renderRecommend(target) {
    const panel = node("section", "panel");
    addPanelHeading(panel, "Проф-тест", "Ответьте на несколько коротких вопросов. Подбор сопоставит ваши интересы с реальными дисциплинами и распределением часов в учебных планах.");
    panel.append(node("p", "small-note", "Проф-тест помогает выбрать направление для изучения. Проверка баллов и условий поступления показывается отдельно и не смешивается с рекомендациями."));
    const buttonRow = node("div", "button-row");
    buttonRow.style.marginTop = "22px";
    const link = node("a", "button", "Пройти Проф-тест");
    link.href = "discover.html";
    buttonRow.append(link);
    panel.append(buttonRow);
    target.append(panel);
  }

  function departmentOptions() {
    const found = new Map();
    for (const program of state.programs) {
      for (const department of departmentsFor(program)) {
        const key = department.code || department.key || department.name;
        if (key) found.set(key, department);
      }
    }
    return [...found.values()].sort((a, b) => `${a.code} ${a.name}`.localeCompare(`${b.code} ${b.name}`, "ru"));
  }

  function renderCatalogGrid(grid, query, selectedDirection, selectedDepartment) {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    const filtered = state.programs.filter(program => {
      if (selectedDirection && directionFor(program).code !== selectedDirection) return false;
      if (selectedDepartment && !departmentsFor(program).some(item => item.code === selectedDepartment)) return false;
      return !needle || programSearchText(program).includes(needle) || text(program.code).toLocaleLowerCase("ru-RU").includes(needle);
    });
    grid.replaceChildren();
    const resultCount = $("#catalogResultCount");
    if (resultCount) resultCount.textContent = `${filtered.length} из ${state.programs.length} программ`;
    if (!filtered.length) {
      const empty = node("div", "empty-state");
      empty.append(node("h2", "", "Ничего не нашлось"), node("p", "", "Поменяйте запрос или сбросьте фильтры, чтобы увидеть другие программы."));
      grid.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach(program => fragment.append(makeCatalogCard(program)));
    grid.append(fragment);
  }

  async function renderCatalog(target) {
    const panel = node("section", "panel");
    addPanelHeading(panel, "Найди свою программу", "Ищи по названию профиля, коду, направлению или кафедре. В подробной карточке доступны связанные планы и дисциплины по семестрам.");
    const toolbar = node("div", "catalog-toolbar");
    const search = node("input", "search-input");
    search.type = "search";
    search.placeholder = "Название, код, предмет или кафедра";
    search.setAttribute("aria-label", "Поиск программ");
    const direction = node("select", "select");
    direction.setAttribute("aria-label", "Фильтр по направлению");
    direction.add(new Option("Все направления", ""));
    for (const item of [...state.directions].sort((a, b) => text(a.code).localeCompare(text(b.code), "ru"))) {
      direction.add(new Option(`${text(item.code)} · ${text(item.name)}`, text(item.code)));
    }
    const department = node("select", "select");
    department.setAttribute("aria-label", "Фильтр по кафедре");
    department.add(new Option("Все кафедры", ""));
    for (const item of departmentOptions()) department.add(new Option(`${item.code} · ${item.name}`, item.code));
    const reset = action("Сбросить", () => {
      search.value = "";
      direction.value = "";
      department.value = "";
      renderCatalogGrid(grid, "", "", "");
      search.focus();
    }, "button secondary");
    reset.classList.add("catalog-reset");
    toolbar.append(search, direction, department, reset);

    const count = node("div", "count-label");
    count.id = "catalogResultCount";
    count.style.marginBlock = "18px 13px";
    const grid = node("div", "catalog-grid");
    search.addEventListener("input", () => renderCatalogGrid(grid, search.value, direction.value, department.value));
    direction.addEventListener("change", () => renderCatalogGrid(grid, search.value, direction.value, department.value));
    department.addEventListener("change", () => renderCatalogGrid(grid, search.value, direction.value, department.value));
    panel.append(toolbar, count, grid);
    const provenance = node("p", "small-note", "Источник: архив вступительной кампании МГТУ 2026. Связи профилей с учебными планами показываются по сохранённым ключам базы.");
    panel.append(provenance);
    target.append(panel);
    renderCatalogGrid(grid, "", "", "");
  }

  async function renderFavorites(target) {
    const keys = readKeyList(favoritesStorageKey);
    if (!keys.length) {
      const empty = node("section", "empty-state");
      empty.append(node("h2", "", "Пока ничего не сохранено"), node("p", "", "Нажмите ☆ у программы в каталоге или подборке, чтобы вернуться к ней позже."));
      const link = node("a", "button", "Открыть каталог");
      link.href = "#catalog";
      empty.append(link);
      target.append(empty);
      return;
    }
    const heading = node("section", "panel");
    addPanelHeading(heading, `${keys.length} сохранено`, "Список привязан к этому браузеру. Избранное не записывается в академическую базу.");
    const list = node("div", "program-results");
    for (const key of keys) {
      const program = selectedProgram(key);
      if (!program) continue;
      const card = node("article", "favorite-card");
      const content = node("div");
      content.append(node("span", "program-code", text(program.code)), node("h3", "", text(program.name)));
      const meta = node("div", "program-meta");
      for (const item of programMeta(program).slice(0, 3)) meta.append(chip(item));
      content.append(meta);
      const actions = node("div", "favorite-actions");
      actions.append(action("Открыть карточку", () => openProgram(key), "button quiet"));
      actions.append(action("Сравнить", () => { addToCompare(key); window.location.hash = "compare"; }, "button quiet"));
      actions.append(action("Убрать", () => { toggleFavorite(key); renderRoute(); }, "button danger"));
      card.append(content, actions);
      list.append(card);
    }
    heading.append(list);
    target.append(heading);
  }

  async function loadProgramBundle(program) {
    const key = programKey(program);
    if (state.bundleCache.has(key)) return state.bundleCache.get(key);
    const loading = (async () => {
      let detail = program;
      let plans = [];
      try {
        detail = await data.get(`/v1/programs/${encodeURIComponent(key)}`);
      } catch { /* Keep the searchable catalog row if the detail route is unavailable. */ }
      try {
        plans = await data.list("/v1/study-plans", { program_key: key });
      } catch { /* A missing plan endpoint is shown as a data gap below. */ }
      const linkedPlan = plans.find(plan => plan.profile_link_status === "verified" && plan.status === "parsed")
        || plans.find(plan => plan.profile_link_status === "verified")
        || null;
      let items = [];
      if (linkedPlan?.status === "parsed" && linkedPlan.profile_link_status === "verified") {
        try {
          items = await data.list(`/v1/study-plans/${encodeURIComponent(linkedPlan.external_key)}/items`);
        } catch { items = []; }
      }
      return { program, detail, plan: linkedPlan, items };
    })();
    state.bundleCache.set(key, loading);
    try {
      const bundle = await loading;
      state.bundleCache.set(key, Promise.resolve(bundle));
      return bundle;
    } catch (error) {
      state.bundleCache.delete(key);
      throw error;
    }
  }

  function formatDepartment(program) {
    const departments = departmentsFor(program);
    return departments.map(item => [item.code, item.name].filter(Boolean).join(" · ")).join(" / ") || "Не указано в связанной записи";
  }

  function courseList(items) {
    const list = node("div", "course-list");
    if (!items.length) {
      list.append(node("p", "course-empty", "В связанном плане нет дисциплин для этого семестра."));
      return list;
    }
    for (const item of items) {
      const row = node("div", "course-row");
      row.append(node("strong", "", text(item.discipline_name) || "Название дисциплины не указано"));
      const parts = [];
      if (item.credits !== null && item.credits !== undefined && text(item.credits)) parts.push(`${text(item.credits)} з.е.`);
      if (number(item.total_hours ?? item.hours) !== null) parts.push(`${number(item.total_hours ?? item.hours)} ч.`);
      if (text(item.control_form)) parts.push(text(item.control_form));
      row.append(node("span", "", parts.join(" · ") || "Сведения не указаны"));
      list.append(row);
    }
    return list;
  }

  async function openProgram(key) {
    const program = selectedProgram(key);
    if (!program) return;
    const token = ++state.dialogToken;
    const direction = directionFor(program);
    dialogBody.replaceChildren();
    const code = node("span", "program-code", text(program.code));
    const heading = node("h2", "dialog-title", text(program.name));
    heading.id = "dialogTitle";
    const summary = node("p", "dialog-description", text(program.description) || "В архиве нет подтверждённого описания этого профиля.");
    const meta = node("div", "program-meta");
    for (const item of programMeta(program)) meta.append(chip(item));
    dialogBody.append(code, heading, summary, meta);
    const buttons = node("div", "button-row");
    buttons.style.marginTop = "18px";
    buttons.append(makeFavoriteButton(key));
    buttons.append(action("Добавить к сравнению", () => {
      addToCompare(key);
      dialog.close();
      window.location.hash = "compare";
    }, "button secondary"));
    dialogBody.append(buttons);

    const loadingSection = node("section", "dialog-section");
    loadingSection.append(node("h3", "", "Учебный план и дисциплины"), node("p", "small-note", "Загружаем связь с планом и предметы по семестрам…"));
    dialogBody.append(loadingSection);
    dialog.showModal();

    const bundle = await loadProgramBundle(program);
    if (token !== state.dialogToken || !dialog.open) return;
    loadingSection.replaceChildren();
    loadingSection.append(node("h3", "", "Учебный план и дисциплины"));
    const officialPlanUrl = bundle.plan?.document_url || bundle.plan?.download_url || bundle.plan?.study_plan_url || bundle.detail.study_plan_url || program.study_plan_url;
    if (!bundle.plan) {
      loadingSection.append(node("div", "notice warning", "В архиве нет подтверждённой связи профиля с учебным планом. Мы не подставляем план похожей программы."));
    } else if (bundle.plan.profile_link_status !== "verified") {
      loadingSection.append(node("div", "notice warning", "Связь профиля и плана требует проверки. Дисциплины не приписаны этой программе."));
    } else if (bundle.items.length) {
      const overview = node("p", "small-note", `Учебный год ${text(bundle.plan.academic_year) || "не указан"} · ${text(bundle.plan.semester_count) || "?"} семестров · ${number(bundle.plan.item_count) ?? bundle.items.length} дисциплин в записи`);
      loadingSection.append(overview);
      const bySemester = new Map();
      for (const item of bundle.items) {
        const semester = number(item.semester);
        if (semester === null) continue;
        if (!bySemester.has(semester)) bySemester.set(semester, []);
        bySemester.get(semester).push(item);
      }
      for (const [semester, items] of [...bySemester].sort((a, b) => a[0] - b[0])) {
        const details = node("details", "semester-accordion");
        if (semester === 1) details.open = true;
        const summaryRow = node("summary");
        summaryRow.append(node("strong", "", `${semester} семестр`), node("span", "", `${items.length} дисциплин`));
        details.append(summaryRow, courseList(items.sort((a, b) => (number(a.ordinal) ?? 0) - (number(b.ordinal) ?? 0))));
        loadingSection.append(details);
      }
    } else {
      loadingSection.append(node("div", "notice warning", `Профиль связан с планом, но дисциплины не удалось загрузить. ${text(bundle.plan.unavailable_reason)}`));
    }
    if (officialPlanUrl || safeUrl(bundle.detail.sources?.[0]?.source_url)) {
      const links = node("div", "dialog-links");
      const planLink = externalLink("Открыть учебный план ↗", officialPlanUrl);
      const sourceLink = externalLink("Страница профиля МГТУ ↗", bundle.detail.catalog_page_url || bundle.detail.sources?.[0]?.source_url);
      if (planLink) links.append(planLink);
      if (sourceLink) links.append(sourceLink);
      loadingSection.append(links);
    }

    const catalogCourses = Array.isArray(bundle.detail.catalog_course_names) ? bundle.detail.catalog_course_names.filter(Boolean) : [];
    if (catalogCourses.length) {
      const section = node("section", "dialog-section");
      section.append(node("h3", "", "Предметы на странице профиля"), node("p", "small-note", "Это названия с карточки программы; они не заменяют дисциплины из учебного плана."));
      const list = node("div", "program-meta");
      for (const course of catalogCourses) list.append(chip(course));
      section.append(list);
      dialogBody.append(section);
    }

    const admission = node("section", "dialog-section");
    admission.append(node("h3", "", "Поступление по направлению"));
    try {
      const rules = await data.list("/v1/requirements", { campaign_key: state.campaign.external_key });
      if (token !== state.dialogToken || !dialog.open) return;
      const matching = rules.filter(rule => rule.direction_code === direction.code);
      if (matching.length) {
        for (const rule of matching.slice(0, 3)) {
          const leaves = [];
          collectLeaves(rule.root, leaves);
          const unique = [...new Map(leaves.map(item => [item.subject_code + item.minimum_score, item])).values()];
          admission.append(node("p", "small-note", unique.map(item => `${subjectLabel(item.subject_code)} от ${text(item.minimum_score)} баллов`).join(" · ")));
        }
      } else {
        admission.append(node("p", "small-note", "Для этого направления в текущем архиве нет связанного требования к экзаменам."));
      }
    } catch {
      admission.append(node("p", "small-note", "Условия приёма сейчас недоступны."));
    }
    dialogBody.append(admission);
  }

  function drawCompare(target) {
    target.replaceChildren();
    if (state.compareBundles.length < 2) return;
    const maxSemester = Math.max(1, ...state.compareBundles.map(bundle => bundle.plan?.profile_link_status === "verified" ? number(bundle.plan.semester_count) || 1 : 1));
    if (state.compareSemester > maxSemester) state.compareSemester = 1;

    const toolbar = node("section", "panel compare-toolbar");
    const caption = node("div");
    caption.append(node("strong", "", "Дисциплины по семестрам"), node("p", "small-note", "Показываем только планы, связь которых с профилем отмечена в архиве как подтверждённая."));
    const semesters = node("div", "semester-tabs");
    for (let semester = 1; semester <= maxSemester; semester += 1) {
      const button = action(String(semester), () => { state.compareSemester = semester; drawCompare(target); }, "semester-tab");
      button.setAttribute("aria-pressed", String(semester === state.compareSemester));
      button.setAttribute("aria-label", `${semester} семестр`);
      semesters.append(button);
    }
    toolbar.append(caption, semesters);
    const grid = node("div", "compare-grid");
    grid.style.setProperty("--compare-columns", String(state.compareBundles.length));
    for (const bundle of state.compareBundles) {
      const program = bundle.program;
      const card = node("article", "compare-card");
      const head = node("header", "compare-card-head");
      head.append(node("span", "program-code", text(program.code)));
      head.append(node("h3", "", text(program.name)));
      head.append(node("p", "", text(program.description) || "Описание профиля не указано в архиве."));
      const headButtons = node("div", "button-row");
      headButtons.style.marginTop = "14px";
      headButtons.append(makeFavoriteButton(programKey(program)), action("Карточка", () => openProgram(programKey(program)), "text-action"));
      head.append(headButtons);

      const facts = node("div", "compare-facts");
      const plan = bundle.plan;
      const detail = bundle.detail;
      const direction = directionFor(detail);
      const values = [
        ["Направление", direction.code ? `${direction.code} · ${direction.name}` : direction.name || "Не указано"],
        ["Кафедра", formatDepartment(detail)],
        ["Год плана", text(plan?.academic_year) || "Не найден"],
        ["Длительность", text(plan?.duration_label) || "Не указана"],
        ["Часы по плану", number(plan?.total_academic_hours) === null ? "Не указано" : `${plan.total_academic_hours} акад. ч.`],
        ["Дисциплин", plan?.profile_link_status === "verified" ? text(plan.item_count ?? bundle.items.length) : "Нет подтверждённой связи"]
      ];
      for (const [label, value] of values) {
        const fact = node("div", "compare-fact");
        fact.append(node("span", "", label), node("strong", "", value));
        facts.append(fact);
      }
      const courseSection = node("section", "course-section");
      courseSection.append(node("h4", "", `${state.compareSemester} семестр`));
      if (!plan) {
        courseSection.append(node("p", "course-empty", "Связанный план не найден в базе."));
      } else if (plan.profile_link_status !== "verified") {
        courseSection.append(node("p", "course-empty", "Связь плана с профилем требует проверки. Предметы не сопоставлены."));
      } else if (plan.status !== "parsed") {
        courseSection.append(node("p", "course-empty", text(plan.unavailable_reason) || "Учебный план не удалось разобрать."));
      } else {
        const items = bundle.items.filter(item => number(item.semester) === state.compareSemester).sort((a, b) => (number(a.ordinal) ?? 0) - (number(b.ordinal) ?? 0));
        courseSection.append(courseList(items));
      }
      card.append(head, facts, courseSection);
      grid.append(card);
    }
    target.append(toolbar, grid);
  }

  async function renderCompare(target, token) {
    const panel = node("section", "panel");
    addPanelHeading(panel, "Выбери от двух до трёх программ", "В сравнении используем учебный план каждого выбранного профиля, а не похожие программы.");
    const picks = node("div", "compare-controls");
    const selectedKeys = readKeyList(compareStorageKey);
    for (let index = 0; index < 3; index += 1) {
      const field = node("div", "field");
      const label = node("label", "", `Программа ${index + 1}`);
      const select = node("select", "select");
      select.id = `compare-program-${index + 1}`;
      label.htmlFor = select.id;
      select.dataset.compareSlot = String(index);
      select.add(new Option("Выберите профиль", ""));
      for (const program of [...state.programs].sort((a, b) => programLabel(a).localeCompare(programLabel(b), "ru"))) {
        select.add(new Option(programLabel(program), programKey(program)));
      }
      if (selectedKeys[index]) select.value = selectedKeys[index];
      field.append(label, select);
      picks.append(field);
    }
    const buttons = node("div", "button-row");
    buttons.style.marginTop = "20px";
    const compareButton = action("Сравнить профили", async () => {
      const keys = [...picks.querySelectorAll("select")].map(select => select.value).filter(Boolean);
      const unique = [...new Set(keys)];
      if (unique.length < 2) {
        status.replaceChildren(node("div", "notice warning", "Выберите минимум две разные программы."));
        return;
      }
      writeKeyList(compareStorageKey, unique);
      compareButton.disabled = true;
      status.replaceChildren(node("div", "loading-panel", "Загружаем проверенные учебные планы и дисциплины…"));
      try {
        state.compareBundles = await Promise.all(unique.map(key => loadProgramBundle(selectedProgram(key))));
        if (token !== state.renderToken) return;
        const sems = state.compareBundles.map(bundle => bundle.plan?.profile_link_status === "verified" ? number(bundle.plan.semester_count) || 1 : 1);
        state.compareSemester = Math.min(state.compareSemester, Math.max(...sems));
        status.replaceChildren();
        drawCompare(status);
      } catch (error) {
        if (token === state.renderToken) status.replaceChildren(errorPanel(error.message));
      } finally {
        compareButton.disabled = false;
      }
    });
    const favorites = action("Добавить избранные", () => {
      const keys = readKeyList(favoritesStorageKey).slice(0, 3);
      const selects = [...picks.querySelectorAll("select")];
      selects.forEach((select, index) => { select.value = keys[index] || ""; });
    }, "button secondary");
    buttons.append(compareButton, favorites);
    panel.append(picks, buttons);
    const status = node("div", "program-results");
    target.append(panel, status);
    if (selectedKeys.length >= 2) compareButton.click();
  }

  const subjectNames = {
    russian_language: "Русский язык",
    mathematics: "Математика",
    physics: "Физика",
    informatics_and_ict: "Информатика и ИКТ",
    chemistry: "Химия",
    biology: "Биология",
    social_science: "Обществознание",
    history: "История",
    foreign_language: "Иностранный язык",
    literature: "Литература",
    geography: "География"
  };

  function subjectLabel(code) {
    return subjectNames[text(code)] || text(code).replaceAll("_", " ").replace(/^./u, first => first.toLocaleUpperCase("ru-RU"));
  }

  async function ensureAdmissionBase() {
    const [requirements, achievements] = await Promise.all([
      state.requirements || data.list("/v1/requirements", { campaign_key: state.campaign.external_key }),
      state.achievements || data.list("/v1/individual-achievements", { campaign_key: state.campaign.external_key })
    ]);
    state.requirements = requirements;
    state.achievements = achievements;
    return { requirements, achievements };
  }

  function collectLeaves(rule, output = []) {
    if (!rule || typeof rule !== "object") return output;
    if (rule.kind === "leaf") output.push(rule);
    for (const child of Array.isArray(rule.children) ? rule.children : []) collectLeaves(child, output);
    return output;
  }

  function requirementResult(rule, scores) {
    if (!rule || typeof rule !== "object") return null;
    if (rule.kind === "leaf") {
      const score = number(scores[rule.subject_code]);
      const minimum = number(rule.minimum_score);
      if (score === null || minimum === null) return null;
      return score >= minimum;
    }
    const children = Array.isArray(rule.children) ? rule.children : [];
    if (!children.length) return null;
    const results = children.map(child => requirementResult(child, scores));
    const operator = text(rule.operator).toUpperCase();
    const threshold = operator === "AND" ? children.length : operator === "OR" ? 1 : number(rule.threshold) ?? children.length;
    const passed = results.filter(result => result === true).length;
    const unknown = results.filter(result => result === null).length;
    if (passed >= threshold) return true;
    if (passed + unknown < threshold) return false;
    return null;
  }

  function ruleStatusLabel(result) {
    return result === true ? "Минимумы выполнены" : result === false ? "Есть балл ниже минимума" : "Заполните баллы ЕГЭ";
  }

  function drawRuleTree(rule, scores) {
    if (!rule || typeof rule !== "object") return node("p", "small-note", "Структура требования в архиве не указана.");
    if (rule.kind === "leaf") {
      const result = requirementResult(rule, scores);
      const leaf = node("div", "rule-leaf");
      if (result === true) leaf.dataset.result = "pass";
      if (result === false) leaf.dataset.result = "fail";
      const label = node("span", "", subjectLabel(rule.subject_code));
      if (rule.is_choice) label.append(document.createTextNode(" · экзамен по выбору"));
      leaf.append(label, node("strong", "", `от ${text(rule.minimum_score)} баллов`));
      return leaf;
    }
    const group = node("div", "rule-tree");
    const operator = text(rule.operator).toUpperCase();
    const threshold = number(rule.threshold);
    const description = operator === "AND" ? "Нужны все предметы" : operator === "OR" ? "Выберите один из предметов" : operator === "AT_LEAST" ? `Нужно выполнить минимум ${threshold ?? "несколько"} условий` : "Условия приёма";
    group.append(node("span", "rule-operator", description));
    const branch = node("div", "rule-branch");
    for (const child of Array.isArray(rule.children) ? rule.children : []) branch.append(drawRuleTree(child, scores));
    group.append(branch);
    return group;
  }

  function renderRequirementCards(container, rules, directionCode, scores) {
    container.replaceChildren();
    const matching = rules.filter(rule => rule.direction_code === directionCode);
    if (!matching.length) {
      container.append(node("div", "notice warning", "В архиве нет связанного набора требований к экзаменам для этого направления."));
      return;
    }
    for (const rule of matching) {
      const card = node("article", "rule-card");
      const header = node("header", "rule-card-header");
      const sourceInfo = rule.sources?.[0];
      const sourceLabel = sourceInfo?.locator?.page ? `Документ, стр. ${sourceInfo.locator.page}` : "Источник из архива";
      const titleText = text(rule.applicant_category).replace(/\s+/g, " ").trim();
      const headerTitle = titleText.length > 145 ? `${titleText.slice(0, 142)}…` : titleText || "Минимальные баллы вступительных испытаний";
      header.append(node("h3", "", headerTitle));
      const result = requirementResult(rule.root, scores);
      const badge = node("span", "rule-status", ruleStatusLabel(result));
      if (result === true) badge.dataset.result = "pass";
      if (result === false) badge.dataset.result = "fail";
      header.append(badge);
      card.append(header, drawRuleTree(rule.root, scores));
      const source = externalLink(sourceLabel + " ↗", sourceInfo?.source_url);
      if (source) card.append(source);
      container.append(card);
    }
  }

  function achievementPoints(policies, selectedKeys) {
    return policies.reduce((sum, item) => selectedKeys.includes(item.external_key) ? sum + (number(item.points) ?? 0) : sum, 0);
  }

  function renderAchievementPicker(container, policies) {
    const tools = node("div", "achievement-tools");
    const total = node("aside", "achievement-total");
    const totalLabel = node("span", "", "Сумма отмеченных значений");
    const totalValue = node("strong", "", `+${achievementPoints(policies, state.profile.achievementKeys)}`);
    const totalNote = node("p", "", "Арифметическая сумма опубликованных значений. Общие лимиты и правила учёта по специальностям здесь не применяются.");
    total.append(totalLabel, totalValue, totalNote);
    const listPanel = node("div");
    const search = node("input", "search-input");
    search.type = "search";
    search.placeholder = "Найти достижение";
    search.setAttribute("aria-label", "Поиск по индивидуальным достижениям");
    const list = node("div", "achievement-list");
    const renderRows = () => {
      const query = search.value.trim().toLocaleLowerCase("ru-RU");
      list.replaceChildren();
      const filtered = policies.filter(item => `${text(item.name)} ${text(item.required_document)}`.toLocaleLowerCase("ru-RU").includes(query));
      if (!filtered.length) {
        list.append(node("p", "small-note", "По этому запросу достижений не найдено."));
        return;
      }
      for (const item of filtered) {
        const row = node("div", "achievement-item");
        const checkbox = node("input");
        checkbox.type = "checkbox";
        checkbox.id = `achievement-${safeId(item.external_key)}`;
        checkbox.checked = state.profile.achievementKeys.includes(item.external_key);
        const label = node("label");
        label.htmlFor = checkbox.id;
        label.append(node("strong", "", text(item.name) || "Индивидуальное достижение"));
        if (text(item.required_document)) label.append(node("small", "", `Подтверждение: ${text(item.required_document)}`));
        const points = number(item.points);
        row.append(checkbox, label, node("span", "achievement-points", points === null ? "баллы не указаны" : `+${points}`));
        checkbox.addEventListener("change", () => {
          const chosen = new Set(state.profile.achievementKeys);
          if (checkbox.checked) chosen.add(item.external_key);
          else chosen.delete(item.external_key);
          state.profile.achievementKeys = [...chosen];
          saveProfile();
          totalValue.textContent = `+${achievementPoints(policies, state.profile.achievementKeys)}`;
        });
        list.append(row);
      }
    };
    search.addEventListener("input", renderRows);
    renderRows();
    listPanel.append(search, list);
    tools.append(total, listPanel);
    container.append(tools);
  }

  function allRequirementSubjects(rules) {
    const subjects = new Map();
    for (const rule of rules) {
      for (const leaf of collectLeaves(rule.root, [])) subjects.set(text(leaf.subject_code), subjectLabel(leaf.subject_code));
    }
    return [...subjects].filter(([code]) => code).sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }

  function makeScoreInputs(target, rules, directionCode, onChange) {
    const subjects = allRequirementSubjects(rules.filter(rule => rule.direction_code === directionCode));
    target.replaceChildren();
    if (!subjects.length) {
      target.append(node("p", "small-note", "У базы пока нет опубликованных экзаменационных требований для этого направления."));
      return;
    }
    for (const [code, label] of subjects) {
      const row = node("div", "score-row");
      const input = node("input", "input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.inputMode = "numeric";
      input.placeholder = "—";
      input.value = state.profile.scores[code] ?? "";
      input.setAttribute("aria-label", `Ваш балл: ${label}`);
      input.addEventListener("input", () => {
        const value = input.value === "" ? "" : number(input.value);
        if (value === "" || value === null) delete state.profile.scores[code];
        else state.profile.scores[code] = Math.max(0, Math.min(100, value));
        saveProfile();
        onChange();
      });
      row.append(node("label", "", label), input);
      target.append(row);
    }
  }

  function labelFunding(value) {
    const known = { budget: "Бюджет", paid: "Платное", contract: "Платное", tuition: "Платное" };
    return known[text(value)] || text(value) || "Форма не указана";
  }

  function labelQuota(value) {
    const known = { general: "Общий конкурс", separate: "Отдельная квота", special: "Особая квота", target: "Целевая квота", bvi: "Без вступительных испытаний" };
    return known[text(value)] || text(value) || "Категория не указана";
  }

  async function loadAdmissionDirectionData(directionCode) {
    const calls = await Promise.allSettled([
      state.pools || data.list("/v1/competition-pools", { campaign_key: state.campaign.external_key }),
      state.offerings || data.list(`/v1/campaigns/${encodeURIComponent(state.campaign.external_key)}/offerings`),
      data.list("/api/v1/statistics", { kind: "historical", direction_code: directionCode }),
      data.list("/api/v1/statistics", { kind: "admission", year: 2026, direction_code: directionCode }),
      data.list("/v1/tuition", { direction_code: directionCode })
    ]);
    if (calls[0].status === "fulfilled") state.pools = calls[0].value;
    if (calls[1].status === "fulfilled") state.offerings = calls[1].value;
    return {
      pools: calls[0].status === "fulfilled" ? calls[0].value.filter(item => item.direction_code === directionCode) : [],
      offerings: calls[1].status === "fulfilled" ? calls[1].value.filter(item => item.direction_code === directionCode) : [],
      historical: calls[2].status === "fulfilled" ? calls[2].value : [],
      current: calls[3].status === "fulfilled" ? calls[3].value : [],
      tuition: calls[4].status === "fulfilled" ? calls[4].value : []
    };
  }

  function drawDirectionFacts(container, directionCode, facts) {
    container.replaceChildren();
    const layout = node("div", "admission-columns");
    const poolsPanel = node("section", "panel");
    addPanelHeading(poolsPanel, "Места и конкурсные категории", "Строки приведены отдельно по уровню конкурса и виду квоты; они не складываются автоматически.");
    const poolList = node("div", "admission-list");
    const pools = facts.pools.filter(pool => number(pool.places) !== null);
    if (!pools.length) poolList.append(node("p", "small-note", "В архиве нет числовых данных о местах для этого направления."));
    for (const pool of pools.slice(0, 28)) {
      const row = node("div", "admission-row");
      const scope = text(pool.department_code) ? `Кафедра ${text(pool.department_code)}` : text(pool.scope_level) === "direction" ? "Направление целиком" : text(pool.scope_level) || "Уровень не указан";
      row.append(node("span", "", `${scope} · ${labelFunding(pool.funding_type)} · ${labelQuota(pool.quota_type)}`), node("strong", "", `${pool.places} мест`));
      poolList.append(row);
    }
    poolsPanel.append(poolList);

    const historyPanel = node("section", "panel");
    addPanelHeading(historyPanel, "Баллы и результаты прошлых лет", "Архивные опубликованные результаты — ориентир для сравнения, не проходной балл будущего набора.");
    const historical = facts.historical.filter(item => number(item.minimum_score) !== null || number(item.score) !== null)
      .sort((a, b) => (number(b.year) || 0) - (number(a.year) || 0));
    const historyList = node("div", "admission-list");
    if (!historical.length) historyList.append(node("p", "small-note", "Для направления нет числовых исторических результатов в загруженном архиве."));
    for (const item of historical.slice(0, 12)) {
      const row = node("div", "admission-row");
      const descriptor = [item.year, labelFunding(item.funding_type), item.scope_type === "department" ? text(item.scope_label) : "направление", item.study_form].filter(Boolean).join(" · ");
      const score = number(item.minimum_score ?? item.score);
      row.append(node("span", "", descriptor), node("strong", "", `${score} баллов`));
      historyList.append(row);
    }
    historyPanel.append(historyList);
    layout.append(poolsPanel, historyPanel);

    const factsPanel = node("section", "panel");
    addPanelHeading(factsPanel, "Предложения и стоимость", "Показываем исходные сведения из набора 2026. Неразрешённые связи с профилем остаются помеченными.");
    const offeringList = node("div", "admission-list");
    const offerings = facts.offerings;
    if (!offerings.length) offeringList.append(node("p", "small-note", "Предложения приёма для направления не найдены."));
    for (const offer of offerings.slice(0, 18)) {
      const program = offer.program_key ? state.programs.find(item => programKey(item) === offer.program_key) : null;
      const name = program?.name || (offer.program_name_in_source ? text(offer.program_name_in_source) : "Предложение без точной связи с профилем");
      const row = node("div", "admission-row");
      row.append(node("span", "", `${name} · ${text(offer.program_link_status) || "связь не указана"}`), node("strong", "", text(offer.study_duration_label) || labelFunding(offer.funding_type)));
      offeringList.append(row);
    }
    const prices = facts.tuition.filter(item => number(item.amount) !== null).sort((a, b) => text(b.academic_year).localeCompare(text(a.academic_year), "ru"));
    for (const price of prices.slice(0, 6)) {
      const row = node("div", "admission-row");
      row.append(node("span", "", `Стоимость · ${text(price.academic_year) || "год не указан"} · ${text(price.table_category) || "категория не указана"}`), node("strong", "", money(price.amount)));
      offeringList.append(row);
    }
    factsPanel.append(offeringList);

    const currentPanel = node("section", "panel");
    addPanelHeading(currentPanel, "Снимок кампании 2026", "Это опубликованные агрегированные данные кампании на дату источника; они не показывают вероятность зачисления.");
    const currentList = node("div", "admission-list");
    const current = facts.current.filter(item => item.admitted_count !== null || item.minimum_score !== null || item.score !== null);
    if (!current.length) currentList.append(node("p", "small-note", "Для этого направления в снимке 2026 пока нет агрегированных числовых результатов."));
    for (const item of current.slice(0, 12)) {
      const row = node("div", "admission-row");
      const label = [text(item.admission_stage), text(item.competition_type), text(item.status)].filter(Boolean).join(" · ") || text(item.statistic_kind) || "Опубликованный результат";
      const values = [];
      if (item.admitted_count !== null) values.push(`${item.admitted_count} зачислено`);
      if (number(item.minimum_score) !== null) values.push(`от ${item.minimum_score} баллов`);
      row.append(node("span", "", label), node("strong", "", values.join(" · ") || "числовые данные не указаны"));
      currentList.append(row);
    }
    currentPanel.append(currentList);
    container.append(layout, factsPanel, currentPanel);
  }

  async function renderAdmission(target, token) {
    const initial = node("section", "panel");
    addPanelHeading(initial, "Проверь баллы и условия", "Минимумы из правил подтверждают прохождение вступительного испытания. Они не равны конкурсному проходному баллу.");
    const directionField = node("div", "field");
    const directionLabel = node("label", "", "Направление подготовки");
    const directionSelect = node("select", "select");
    directionSelect.id = "admission-direction";
    directionLabel.htmlFor = directionSelect.id;
    directionSelect.setAttribute("aria-label", "Направление подготовки");
    const directions = state.directions.length ? state.directions : [...new Map(state.programs.map(program => {
      const direction = directionFor(program);
      return [direction.code, { code: direction.code, name: direction.name, external_key: direction.key }];
    })).values()];
    for (const direction of [...directions].sort((a, b) => text(a.code).localeCompare(text(b.code), "ru"))) {
      directionSelect.add(new Option(`${text(direction.code)} · ${text(direction.name)}`, text(direction.code)));
    }
    const savedDirection = state.profile.directionCode;
    const defaultDirection = directions.some(item => item.code === savedDirection) ? savedDirection
      : directions.some(item => item.code === "09.03.01") ? "09.03.01"
        : directions[0]?.code || "";
    directionSelect.value = defaultDirection;
    directionField.append(directionLabel, directionSelect);
    const profileLink = node("a", "button secondary", "Все мои баллы и достижения");
    profileLink.href = "#profile";
    const fieldRow = node("div", "field-grid");
    fieldRow.append(directionField, profileLink);
    const sourcesNote = node("div", "notice", "Источник: правила приёма МГТУ и архив конкурсных данных 2026. Даты, минимумы и число мест относятся к году, указанному в источнике.");
    initial.append(fieldRow, sourcesNote);

    const scorePanel = node("section", "panel");
    addPanelHeading(scorePanel, "Твои результаты ЕГЭ", "Введённые баллы сохраняются в профиле этого браузера и сравниваются с требованиями направления.");
    const scoreGrid = node("div", "score-grid");
    const scoreLink = node("p", "small-note", "Заполни только те предметы, по которым уже известны результаты.");
    scorePanel.append(scoreGrid, scoreLink);

    const rulesPanel = node("section", "panel");
    addPanelHeading(rulesPanel, "Минимальные баллы по правилам приёма", "Если в правиле есть «И» или «ИЛИ», сохраняем эту логику при проверке.");
    const rulesOutput = node("div", "rule-list");
    rulesPanel.append(rulesOutput);

    const achievementsPanel = node("section", "panel");
    addPanelHeading(achievementsPanel, "Индивидуальные достижения", "Отметь то, что у тебя есть. Список и документы взяты из опубликованной политики приёма МГТУ 2026.");
    const achievementsBody = node("div", "loading-panel");
    achievementsBody.append(node("span", "loader"), node("p", "", "Загружаем перечень достижений…"));
    achievementsPanel.append(achievementsBody);

    const factsPanel = node("div", "program-results");
    const factsLoading = node("div", "loading-panel");
    factsLoading.append(node("span", "loader"), node("p", "", "Загружаем места, исторические результаты и предложения…"));
    factsPanel.append(factsLoading);
    target.append(initial, scorePanel, rulesPanel, achievementsPanel, factsPanel);

    try {
      const { requirements, achievements } = await ensureAdmissionBase();
      if (token !== state.renderToken) return;
      const renderForDirection = () => {
        const code = directionSelect.value;
        state.profile.directionCode = code;
        saveProfile();
        makeScoreInputs(scoreGrid, requirements, code, () => renderRequirementCards(rulesOutput, requirements, code, state.profile.scores));
        renderRequirementCards(rulesOutput, requirements, code, state.profile.scores);
      };
      renderForDirection();
      renderAchievementPicker(achievementsBody, achievements);
      directionSelect.addEventListener("change", renderForDirection);
      const directionData = await loadAdmissionDirectionData(directionSelect.value);
      if (token !== state.renderToken) return;
      drawDirectionFacts(factsPanel, directionSelect.value, directionData);
      directionSelect.addEventListener("change", async () => {
        factsPanel.replaceChildren();
        const loading = node("div", "loading-panel");
        loading.append(node("span", "loader"), node("p", "", "Обновляем данные по направлению…"));
        factsPanel.append(loading);
        const facts = await loadAdmissionDirectionData(directionSelect.value);
        if (token === state.renderToken) drawDirectionFacts(factsPanel, directionSelect.value, facts);
      });
    } catch (error) {
      if (token === state.renderToken) {
        achievementsBody.replaceChildren(node("div", "notice warning", "Перечень достижений или условия приёма временно недоступны."));
        rulesOutput.replaceChildren(errorPanel(error.message));
      }
    }
  }

  async function renderProfile(target) {
    const { requirements, achievements } = await ensureAdmissionBase();
    const scorePanel = node("section", "panel");
    addPanelHeading(scorePanel, "Баллы ЕГЭ", "Баллы не отправляются на сервер: они остаются в localStorage этого браузера.");
    const allSubjects = allRequirementSubjects(requirements);
    const scoreGrid = node("div", "score-grid");
    for (const [code, label] of allSubjects) {
      const row = node("div", "score-row");
      const input = node("input", "input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.inputMode = "numeric";
      input.placeholder = "—";
      input.value = state.profile.scores[code] ?? "";
      input.setAttribute("aria-label", `Ваш балл: ${label}`);
      input.addEventListener("input", () => {
        if (input.value === "") delete state.profile.scores[code];
        else state.profile.scores[code] = Math.max(0, Math.min(100, number(input.value) || 0));
        saveProfile();
      });
      row.append(node("label", "", label), input);
      scoreGrid.append(row);
    }
    if (!allSubjects.length) scoreGrid.append(node("p", "small-note", "В источниках пока нет списка экзаменов."));
    scorePanel.append(scoreGrid);

    const interestsPanel = node("section", "panel");
    addPanelHeading(interestsPanel, "Интересы для подбора", "Отмеченные темы будут использоваться в подборке программ по описаниям и дисциплинам из каталога.");
    const interests = node("div", "interest-grid");
    interestChoices(interests, state.profile.interests, values => {
      state.profile.interests = values;
      saveProfile();
    }, "profile-interests");
    interestsPanel.append(interests);

    const achievementPanel = node("section", "panel");
    addPanelHeading(achievementPanel, "Индивидуальные достижения", "Здесь хранятся только выбранные вами отметки. В академической базе нет личных записей абитуриентов.");
    const achievementBody = node("div");
    renderAchievementPicker(achievementBody, achievements);
    achievementPanel.append(achievementBody);

    const notice = node("div", "notice", "Профиль используется на этом устройстве для подбора и проверки условий. Чтобы удалить локальные баллы и достижения, очистите их поля и снимите отметки.");
    target.append(scorePanel, interestsPanel, achievementPanel, notice);
  }

  function safeId(value) { return text(value).replace(/[^a-zA-Z0-9_-]/g, "-").slice(-90) || "item"; }

  loadBaseData().then(renderRoute).catch(error => {
    setSourceState("error", "Источник данных временно недоступен");
    view.replaceChildren(errorPanel(error.message || "Каталог временно недоступен."));
  });
})();
