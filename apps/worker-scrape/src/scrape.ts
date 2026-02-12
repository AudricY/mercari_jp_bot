import { chromium, type Browser } from "playwright";

import { parsePrice } from "@mercari-bot/core";

interface ScanFilters {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
}

interface RawElement {
  href: string;
  title: string;
  text: string;
  imageUrl: string;
}

export interface ScrapedListing {
  title: string;
  url: string;
  imageUrl: string;
  currency: string;
  numericPrice: number;
  rawPriceDisplay: string;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(headless: boolean): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless });
  }
  return browserPromise;
}

function buildSearchUrl(term: string, filters: ScanFilters): string {
  const url = new URL("https://jp.mercari.com/search");
  url.searchParams.set("keyword", term);
  url.searchParams.set("sort", "created_time");
  url.searchParams.set("order", "desc");
  url.searchParams.set("status", "on_sale");

  if (typeof filters.priceMin === "number") {
    url.searchParams.set("price_min", String(filters.priceMin));
  }

  if (typeof filters.priceMax === "number") {
    url.searchParams.set("price_max", String(filters.priceMax));
  }

  if (filters.excludeKeyword) {
    url.searchParams.set("exclude_keyword", filters.excludeKeyword);
  }

  return url.toString();
}

function applyListingFilters(listing: { title: string }, filters: ScanFilters): boolean {
  const titleLower = listing.title.toLowerCase();

  if (filters.titleMustContain.length > 0) {
    const hasRequiredTerm = filters.titleMustContain.some((term) => titleLower.includes(term.toLowerCase()));
    if (!hasRequiredTerm) {
      return false;
    }
  }

  if (filters.excludeKeyword && titleLower.includes(filters.excludeKeyword.toLowerCase())) {
    return false;
  }

  return true;
}

export async function scanMercariTerm(params: {
  term: string;
  filters: ScanFilters;
  headless: boolean;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  maxItems: number;
}): Promise<ScrapedListing[]> {
  const browser = await getBrowser(params.headless);
  const context = await browser.newContext({
    locale: "ja-JP",
    viewport: { width: 1920, height: 2400 },
    javaScriptEnabled: true,
  });

  const page = await context.newPage();
  const url = buildSearchUrl(params.term, params.filters);

  await page.goto(url, {
    timeout: params.navigationTimeoutMs,
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector('li[data-testid="item-cell"]', {
    timeout: params.selectorTimeoutMs,
  });

  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  });

  const elements = await page.$$eval('li[data-testid="item-cell"]', (nodes) => {
    const rows: RawElement[] = [];

    for (const node of nodes) {
      const anchor = node.querySelector("a");
      const title =
        node.querySelector('span[data-testid="thumbnail-item-name"]')?.textContent?.trim() ??
        anchor?.getAttribute("title")?.trim() ??
        "";
      const href = anchor?.getAttribute("href") ?? "";
      const imageUrl = node.querySelector("img")?.getAttribute("src") ?? "";
      const text = node.textContent?.trim() ?? "";

      if (!href || !title) {
        continue;
      }

      rows.push({
        href,
        title,
        text,
        imageUrl,
      });
    }

    return rows;
  });

  await context.close();

  const parsed: ScrapedListing[] = [];

  for (const row of elements.slice(0, params.maxItems)) {
    const price = parsePrice(row.text);
    if (!price) {
      continue;
    }

    if (!applyListingFilters({ title: row.title }, params.filters)) {
      continue;
    }

    parsed.push({
      title: row.title,
      url: row.href.startsWith("http") ? row.href : `https://jp.mercari.com${row.href}`,
      imageUrl: row.imageUrl,
      currency: price.currency,
      numericPrice: price.numericPrice,
      rawPriceDisplay: price.displayPrice,
    });
  }

  return parsed;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}
