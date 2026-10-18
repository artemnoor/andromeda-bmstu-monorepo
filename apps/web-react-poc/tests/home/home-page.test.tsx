import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "../../src/features/home/home-page";
import styles from "../../src/features/home/home-page.module.css";
import headerStyles from "../../src/widgets/andromeda-navigation/andromeda-header.module.css";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("home page interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 600px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    // Navigation does not depend on GPU support; jsdom has no WebGL context.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("presents the home sections in the requested order with working routes", () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: /Выбери направление.*Спроектируй своё будущее/ })).toBeInTheDocument();
    expect([...container.querySelectorAll("main > section[id]")].map((section) => section.id)).toEqual([
      "comparison-overview",
      "career-guidance",
      "program-catalog",
      "admission-and-sources",
      "final-cta",
    ]);
    expect(screen.getByRole("link", { name: "Сравнить направление" })).toHaveAttribute("href", "/compare");
    for (const link of screen.getAllByRole("link", { name: "Пройти профтест" })) {
      expect(link).toHaveAttribute("href", "/discover");
    }
    expect(screen.getAllByRole("link", { name: "Открыть каталог программ" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Открыть каталог программ" })) {
      expect(link).toHaveAttribute("href", "/programs");
    }
    const admission = screen.getByRole("link", { name: "Изучить условия поступления" });
    expect(admission).toHaveAttribute("href", "/programs");
    expect(admission).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Открыть сравнение" })).toHaveAttribute("href", "/compare");
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
    fireEvent.click(container.querySelector(`.${headerStyles.backdrop}`)!);
    expect(screen.getByRole("button", { name: "Открыть меню" })).toHaveFocus();
    expect(scene).not.toHaveAttribute("inert");
  });
});
