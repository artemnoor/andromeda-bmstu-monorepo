import { discoverLiveCurriculumPrograms, expect, expectHealthyBrowser, test } from "./fixtures";

// Each selection size has the same six-width assertions and its own finite
// budget; twelve DPR=2 screenshots in one test exhaust WebKit's capture budget.
for (const count of [3, 2]) {
  test(`comparison remains readable with ${count} programs at six widths`, async ({ page, diagnostics }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const programs = await discoverLiveCurriculumPrograms(page, 3);
    await page.addInitScript((keys) => localStorage.setItem("andromeda.compare.v1", JSON.stringify(keys)), programs.map((program) => program.externalKey));
    await page.goto("/compare");
    await expect(page.locator('[data-qa="active-release-note"]')).toBeVisible();
    await expect(page.locator('[data-qa="admission-summary"]')).toHaveAttribute("data-unavailable-count", "0");
    const totals = programs.map((program) => ({ key: program.externalKey, hours: program.expectedHours }));

    if (count === 2) {
      await page.getByRole("button", { name: `Убрать программу ${programs[2]!.code} из сравнения`, exact: true }).click();
      await expect(page.locator('[data-qa="category-chart-card"]')).toHaveCount(2);
      await expect(page.locator('[data-qa="active-release-note"]')).toBeVisible();
    }
    for (const width of [320, 390, 600, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `page overflow at ${width}px/${count} programs`).toBeLessThanOrEqual(width);
      const admission = page.locator('[data-qa="admission-summary"]');
      expect(await admission.evaluate((element) => element.scrollWidth), "admission content fits its container").toBeLessThanOrEqual(await admission.evaluate((element) => element.clientWidth));
      for (const program of programs.slice(0, count)) {
        // Check each current contract independently: education facts, enrollment
        // by funding/quota, and scores. A single legacy cell total hid which
        // section was missing after enrollment was split into five rows.
        const programCells = `td[data-program-label="${program.code}"]`;
        await expect(admission.locator("table").filter({ has: page.getByRole("rowheader", { name: "Стоимость обучения", exact: true }) }).locator(programCells)).toHaveCount(2);
        await expect(admission.getByRole("table", { name: /Зачислено на всё направление подготовки/ }).locator(programCells)).toHaveCount(5);
        await expect(admission.getByRole("table", { name: /Минимальные баллы зачисленных/ }).locator(programCells)).toHaveCount(5);
        const card = page.locator('[data-qa="category-chart-card"]').filter({ has: page.locator(`[data-qa="category-program-code"]`, { hasText: program.code }) });
        await expect(card).toHaveAttribute("data-item-count", String(program.expectedItemCount));
        if (program.expectedHours !== null) await expect(card).toHaveAttribute("data-total-hours", String(program.expectedHours));
      }
      await admission.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`admission-${count}-${width}.png`) });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /Подробнее о категории/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await dialog.evaluate((element) => element.clientWidth));
    await page.screenshot({ path: testInfo.outputPath("category-mobile-dialog.png") });
    await page.getByRole("button", { name: "Закрыть подробности категории" }).click();

    const workloadChart = page.getByRole("group", { name: "Сравнение нагрузки по семестрам" });
    await expect(workloadChart).toBeVisible();
    await expect(workloadChart.locator(".recharts-wrapper")).toBeVisible();
    await page.getByText("Открыть таблицу и фильтры", { exact: true }).click();
    await page.getByRole("searchbox", { name: "Найти дисциплину или категорию" }).fill("несуществующая дисциплина 987");
    await expect(page.getByText("По этим фильтрам дисциплин нет.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("searchbox", { name: "Найти дисциплину или категорию" }).fill("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach("independent-curriculum-totals", { body: JSON.stringify(totals), contentType: "application/json" });
    expectHealthyBrowser(diagnostics);
  });
}
