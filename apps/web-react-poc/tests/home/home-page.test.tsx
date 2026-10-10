import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "../../src/features/home/home-page";
import styles from "../../src/features/home/home-page.module.css";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("home page interactions", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves the main React routes and hands out-of-scope cards to vanilla pages", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "МГТУ имени Баумана × Андромеда" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сравнить программы" })).toHaveAttribute("href", "/compare");
    expect(screen.getByRole("link", { name: "Открыть каталог образовательных программ" })).toHaveAttribute("href", "/programs");
    expect(screen.getByRole("link", { name: "Пройти проф-тест, исходная версия Andromeda, новая вкладка" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Проверить поступление, исходная версия Andromeda, новая вкладка" })).toHaveAttribute("target", "_blank");
  });

  it("opens and closes navigation with Escape and backdrop, restoring focus and inert state", async () => {
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);
    const menuButton = screen.getByRole("button", { name: "Открыть меню" });
    const scene = container.querySelector(`.${styles.pageScene}`) as HTMLDivElement;

    await user.click(menuButton);
    expect(screen.getByRole("button", { name: "Закрыть меню" })).toHaveAttribute("aria-expanded", "true");
    // jsdom does not reflect the `inert` boolean attribute as a DOM property.
    expect(scene).toHaveAttribute("inert");
    await waitFor(() => expect(screen.getByRole("link", { name: "Главная" })).toHaveFocus());

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Открыть меню" })).toHaveFocus();
    expect(scene).not.toHaveAttribute("inert");

    await user.click(menuButton);
    fireEvent.click(container.querySelector(`.${styles.backdrop}`)!);
    expect(screen.getByRole("button", { name: "Открыть меню" })).toHaveFocus();
    expect(scene).not.toHaveAttribute("inert");
  });
});
