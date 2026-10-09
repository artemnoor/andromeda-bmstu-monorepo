import { expect as baseExpect, test as baseTest } from "@playwright/test";

export const expect = baseExpect;

export const test = baseTest.extend({
  browserDiagnostics: async ({ page }, use, testInfo) => {
    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    const httpFailures = [];
    const allowedHttpFailures = [];
    const allowedConsoleErrorFragments = new Set();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("requestfailed", (request) => {
      try {
        if (["http:", "https:"].includes(new URL(request.url()).protocol)) {
          requestFailures.push({ url: request.url(), error: request.failure()?.errorText || "request failed" });
        }
      } catch {
        requestFailures.push({ url: request.url(), error: "invalid request URL" });
      }
    });
    page.on("response", (response) => {
      try {
        if (["http:", "https:"].includes(new URL(response.url()).protocol) && response.status() >= 400) {
          httpFailures.push({ url: response.url(), status: response.status() });
        }
      } catch {
        // Ignore browser-internal URLs which are not HTTP URLs.
      }
    });

    await use({
      consoleErrors,
      pageErrors,
      requestFailures,
      httpFailures,
      allowHttpStatus(status, pathname = null) {
        allowedHttpFailures.push({ status, pathname });
      },
      allowConsoleError(fragment) {
        allowedConsoleErrorFragments.add(fragment);
      },
    });

    const diagnostics = {
      consoleErrors,
      pageErrors,
      requestFailures,
      httpFailures,
    };
    if (Object.values(diagnostics).some((items) => items.length > 0)) {
      await testInfo.attach("browser-diagnostics.json", {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: "application/json",
      });
    }

    baseExpect(pageErrors, "uncaught page errors").toEqual([]);
    baseExpect(
      consoleErrors.filter((message) => ![...allowedConsoleErrorFragments].some((fragment) => message.includes(fragment))),
      "unexpected browser console errors",
    ).toEqual([]);
    baseExpect(requestFailures, "failed HTTP network requests").toEqual([]);
    baseExpect(
      httpFailures.filter((failure) => !allowedHttpFailures.some((allowed) =>
        allowed.status === failure.status && (!allowed.pathname || new URL(failure.url).pathname === allowed.pathname))),
      "unexpected HTTP failures",
    ).toEqual([]);
  },
});

export const demoPages = [
  { path: "index.html", selector: "#home-actions" },
  { path: "first-screen.html", selector: "main.page .hero" },
  { path: "programs.html", selector: "#programGrid" },
  { path: "compare.html", selector: "#compareContent" },
  { path: "favorites.html", selector: "#favoriteGrid" },
  { path: "profile.html", selector: "#profileForm" },
  { path: "admission.html", selector: "#dataStatus" },
  { path: "discover.html", selector: "#testExperience" },
  { path: "workspace.html#catalog", selector: "#workspaceView" },
];

export async function openDemoPage(page, path) {
  const target = new URL(path, "http://andromeda.test");
  target.searchParams.set("data", "demo");
  const response = await page.goto(target.pathname + target.search + target.hash);
  baseExpect(response, "page navigation response").not.toBeNull();
  baseExpect(response.status(), "page HTTP status").toBe(200);
  return response;
}

export async function waitForPageData(page, path) {
  if (path.startsWith("programs.html")) {
    await baseExpect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  } else if (path.startsWith("compare.html")) {
    await baseExpect(page.locator("#compareContent")).toHaveAttribute("aria-busy", "false");
  } else if (path.startsWith("favorites.html")) {
    await baseExpect(page.locator("#favoriteGrid")).toHaveAttribute("aria-busy", "false");
  } else if (path.startsWith("profile.html")) {
    await baseExpect(page.locator("#achievementList .loading-state")).toHaveCount(0);
  } else if (path.startsWith("admission.html")) {
    await baseExpect(page.locator("#dataStatus")).toContainText("ДЕМО");
  } else if (path.startsWith("discover.html")) {
    await baseExpect(page.locator("#testLoading")).toBeHidden();
    await baseExpect(page.locator("#testPanel")).toBeVisible();
  } else if (path.startsWith("workspace.html")) {
    await baseExpect(page.locator("#workspaceView .catalog-card").first()).toBeVisible();
  }
}

export async function expectNoHorizontalOverflow(page, width) {
  await baseExpect.poll(
    () => page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      if (scrollWidth <= window.innerWidth) return true;
      return {
        scrollWidth,
        viewportWidth: window.innerWidth,
        offenders: [...document.querySelectorAll("body *")]
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: typeof element.className === "string" ? element.className : "",
            right: Math.round(element.getBoundingClientRect().right),
            left: Math.round(element.getBoundingClientRect().left),
          }))
          .filter((element) => element.right > window.innerWidth + 1 || element.left < -1)
          .sort((first, second) => second.right - first.right)
          .slice(0, 6),
      };
    }),
    { message: "document should not scroll horizontally at viewport " + width },
  ).toBe(true);
}
