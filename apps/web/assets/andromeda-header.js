(() => {
  const routes = [
    ["index.html", "Главная"],
    ["discover.html", "Проф-тест"],
    ["compare.html", "Сравнить программы"],
    ["programs.html", "Каталог программ"],
  ];
  const currentFile = location.pathname.split("/").filter(Boolean).pop() || "index.html";
  const root = document.createElement("div");
  root.className = "andromeda-header-root";
  root.innerHTML = `
    <header class="andromeda-site-header" aria-hidden="true"></header>
    <a class="andromeda-site-logo" href="index.html" aria-label="Andromeda × BMSTU — главная">
      <img src="assets/andromeda-symbol.png" alt="">
    </a>
    <div class="andromeda-menu-backdrop" data-menu-close aria-hidden="true"></div>
    <button class="andromeda-menu-button" type="button" aria-label="Открыть меню" aria-expanded="false" aria-controls="andromedaMenuPanel">
      <span></span><span></span>
    </button>
    <div class="andromeda-menu-shell">
      <aside class="andromeda-menu-panel" id="andromedaMenuPanel" aria-label="Основная навигация" aria-hidden="true" inert>
        <div class="andromeda-menu-content">
          <nav aria-label="Разделы сайта">
            <ul class="andromeda-menu-list">
              ${routes.map(([href, label], index) => `<li class="andromeda-menu-item"><a class="andromeda-menu-link" href="${href}"${currentFile === href ? ' aria-current="page"' : ""}><span class="andromeda-menu-number">${String(index + 1).padStart(2, "0")}</span><span class="andromeda-menu-label">${label}</span></a></li>`).join("")}
            </ul>
          </nav>
          <div class="andromeda-menu-footer"><span>ANDROMEDA × BMSTU</span><span>Навигация по разделам проекта</span></div>
        </div>
      </aside>
    </div>`;
  document.body.prepend(root);

  const button = root.querySelector(".andromeda-menu-button");
  const panel = root.querySelector(".andromeda-menu-panel");
  const firstLink = root.querySelector(".andromeda-menu-link");
  const closeTriggers = root.querySelectorAll("[data-menu-close]");
  let previousOverflow = "";

  function openMenu() {
    previousOverflow = document.body.style.overflow;
    document.body.classList.add("menu-open");
    document.body.style.overflow = "hidden";
    panel.inert = false;
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Закрыть меню");
    window.setTimeout(() => firstLink?.focus(), 0);
  }

  function closeMenu(returnFocus = true) {
    if (!document.body.classList.contains("menu-open")) return;
    document.body.classList.remove("menu-open");
    document.body.style.overflow = previousOverflow;
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Открыть меню");
    if (returnFocus) button.focus();
  }

  button.addEventListener("click", () => {
    if (document.body.classList.contains("menu-open")) closeMenu(false);
    else openMenu();
  });
  closeTriggers.forEach((trigger) => trigger.addEventListener("click", () => closeMenu()));
  root.querySelectorAll(".andromeda-menu-link").forEach((link) => link.addEventListener("click", () => closeMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
})();
