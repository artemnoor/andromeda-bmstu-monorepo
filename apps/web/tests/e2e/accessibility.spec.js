import AxeBuilder from "@axe-core/playwright";
import { demoPages, expect, openDemoPage, test, waitForPageData } from "./support.js";

test.describe("WCAG 2.1 AA automated checks on each original page", () => {
  for (const entry of demoPages) {
    test(entry.path + " has no automated WCAG A/AA violations", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "axe-core audit runs in Chromium to avoid repeating identical accessibility analysis in each engine.");
      await page.setViewportSize({ width: 1440, height: 900 });
      await openDemoPage(page, entry.path);
      await waitForPageData(page, entry.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const report = results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodeCount: nodes.length,
        samples: [...new Map(nodes.map((node) => [node.failureSummary, node])).values()].map(({ target, failureSummary }) => ({
          target,
          reason: failureSummary.split("\n").find((line) => line.trim().startsWith("Element has insufficient"))?.trim() || failureSummary.split("\n")[1]?.trim(),
        })),
      }));
      if (report.length) console.log(entry.path, JSON.stringify(report));
      expect(report).toEqual([]);
    });
  }

  for (const entry of demoPages) {
    test(entry.path + " has no automated WCAG A/AA violations at mobile width", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "axe-core mobile audit runs once in Chromium.");
      await page.setViewportSize({ width: 390, height: 844 });
      await openDemoPage(page, entry.path);
      await waitForPageData(page, entry.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const report = results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
      if (report.length) console.log(entry.path, "mobile", JSON.stringify(report));
      expect(report).toEqual([]);
    });
  }
});
