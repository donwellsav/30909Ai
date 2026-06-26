import { existsSync } from "fs";
import path from "path";
import type { Browser, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { BrowserUseState } from "./browser-types";
import { getSettings } from "./local-store";

let browserPromise: Promise<Browser> | null = null;

function browserCommand() {
  const configured = getSettings().browser || "";
  if (configured && !/msedge/i.test(configured)) return configured;

  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Chromium", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Chromium", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Chromium", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chromium/Chrome was not found. Install Chromium or Chrome, then retry Browser Use.");
  return found;
}

export async function ensureBrowserUse() {
  const current = await browserPromise?.catch(() => null);
  if (current?.isConnected()) return current;
  browserPromise = chromium.launch({
    executablePath: browserCommand(),
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  return browserPromise;
}

async function activePage() {
  const browser = await ensureBrowserUse();
  const context = browser.contexts()[0] || await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  return context.pages()[0] || await context.newPage();
}

function target(page: Page, selector: string) {
  if (selector.startsWith("text=")) return page.getByText(selector.slice(5), { exact: true });
  if (selector.startsWith("label=")) return page.getByLabel(selector.slice(6), { exact: true });
  if (selector.startsWith("placeholder=")) return page.getByPlaceholder(selector.slice(12), { exact: true });
  return page.locator(selector);
}

function normalizeUrl(value: string) {
  let url = value.trim();
  if (!url || url === "about:blank") return url || "about:blank";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(url) ? `http://${url}` : `https://${url}`;
  }
  return url;
}

export async function goto(url: string) {
  const page = await activePage();
  await page.goto(normalizeUrl(url), { waitUntil: "domcontentloaded", timeout: 30000 });
  return readState(page);
}

export async function back() {
  const page = await activePage();
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => undefined);
  return readState(page);
}

export async function forward() {
  const page = await activePage();
  await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => undefined);
  return readState(page);
}

export async function reload() {
  const page = await activePage();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
  return readState(page);
}

export async function click(selector: string) {
  const page = await activePage();
  await target(page, selector).click({ timeout: 10000 });
  return readState(page);
}

export async function type(selector: string, text: string) {
  const page = await activePage();
  await target(page, selector).fill(text, { timeout: 10000 });
  return readState(page);
}

export async function snapshot() {
  return readState(await activePage());
}

async function readState(page: Page): Promise<BrowserUseState> {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
  const [title, text, elements, screenshot] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 3000 }).catch(() => ""),
    page.locator("a,button,input,textarea,select,[role=button]").evaluateAll((nodes) => nodes.slice(0, 40).map((node) => {
      const element = node as HTMLElement;
      const label = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("placeholder") || element.getAttribute("name") || element.getAttribute("href") || "").replace(/\s+/g, " ").trim();
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${CSS.escape(element.id)}` : "";
      const name = element.getAttribute("name") ? `${tag}[name="${CSS.escape(element.getAttribute("name") || "")}"]` : "";
      return { tag, label: label.slice(0, 100), selector: id || name || (label ? `text=${label.slice(0, 60)}` : tag) };
    })).catch(() => []),
    page.screenshot({ fullPage: false, type: "png" }).then((bytes) => Buffer.from(bytes).toString("base64")).catch(() => ""),
  ]);
  return { url: page.url(), title, text: text.slice(0, 4000), elements, screenshot };
}
