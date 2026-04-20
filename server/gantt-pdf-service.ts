import type { Browser } from "playwright";
import { logError, logInfo } from "./utils/logger";

const READY_TIMEOUT_MS = 30000;
const NAV_TIMEOUT_MS = 30000;

export interface GanttPdfOptions {
  projectCode: string;
  theme?: "light" | "dark";
  showBaseline?: boolean;
  authCookie?: { name: string; value: string };
  origin: string;
}

declare global {
  interface Window {
    __GANTT_READY?: boolean;
    __GANTT_ERROR?: string | null;
  }
}

let cachedBrowserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!cachedBrowserPromise) {
    cachedBrowserPromise = (async () => {
      const { chromium } = await import("playwright");
      const executablePath =
        process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        undefined;
      const browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
      browser.on("disconnected", () => {
        cachedBrowserPromise = null;
      });
      return browser;
    })().catch((err) => {
      cachedBrowserPromise = null;
      throw err;
    });
  }
  return cachedBrowserPromise;
}

export async function renderGanttPdf(opts: GanttPdfOptions): Promise<Buffer> {
  const { projectCode, theme = "light", showBaseline = true, authCookie, origin } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });

  try {
    if (authCookie) {
      const url = new URL(origin);
      await context.addCookies([
        {
          name: authCookie.name,
          value: authCookie.value,
          domain: url.hostname,
          path: "/",
          httpOnly: true,
          secure: url.protocol === "https:",
          sameSite: "Lax",
        },
      ]);
    }

    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    const url = new URL(`/print/projects/${encodeURIComponent(projectCode)}/schedule`, origin);
    url.searchParams.set("theme", theme);
    url.searchParams.set("baseline", showBaseline ? "1" : "0");

    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    await page.waitForFunction(
      () => window.__GANTT_READY === true,
      { timeout: READY_TIMEOUT_MS },
    );

    const ganttError = await page.evaluate(() => window.__GANTT_ERROR || null);
    if (ganttError) {
      throw new Error(`Print page reported error: ${ganttError}`);
    }

    const pdfBuffer = await page.pdf({
      format: "A3",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });

    return pdfBuffer;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function shutdownGanttBrowser(): Promise<void> {
  if (!cachedBrowserPromise) return;
  try {
    const browser = await cachedBrowserPromise;
    await browser.close();
  } catch (err) {
    logError("Failed to close gantt browser", err as Error);
  } finally {
    cachedBrowserPromise = null;
  }
}

export async function isGanttRendererAvailable(): Promise<boolean> {
  try {
    await getBrowser();
    return true;
  } catch (err) {
    logInfo("Server-side Gantt renderer unavailable", { error: (err as Error).message });
    return false;
  }
}
