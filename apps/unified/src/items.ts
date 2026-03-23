import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma, PrismaClient } from "@prisma/client";
import YAML from "yaml";

const SOFTWARE_CSV_PATH = fileURLToPath(new URL("../../../to_buy_softawre.csv", import.meta.url));
const HARDWARE_CATALOG_PATH = fileURLToPath(new URL("../../../catalog/hardware-items.yaml", import.meta.url));

const BUNDLE_PATTERNS = [
  /まとめ売り/u,
  /セット/u,
  /ソフト\d+本/u,
  /\d+本セット/u,
  /同梱/u,
];

const MERCH_PATTERNS = [
  /うちわ/u,
  /チラシ/u,
  /フライヤー/u,
  /販促/u,
  /非売品/u,
  /ポスター/u,
  /ステッカー/u,
  /キーホルダー/u,
  /キーチェーン/u,
  /アクリル/u,
  /アクスタ/u,
  /缶バッジ/u,
  /クリアファイル/u,
  /マグネット/u,
  /コースター/u,
  /トレカ/u,
  /カード/u,
  /フィギュア/u,
  /ぬいぐるみ/u,
  /クッション/u,
  /ストラップ/u,
];

const ACCESSORY_PATTERNS = [
  /ポーチ/u,
  /バッグ/u,
  /ケース/u,
  /カバー/u,
  /保護フィルム/u,
  /コントローラ/u,
  /コントローラー/u,
  /joy[\s-]?con/i,
  /ジョイコン/u,
  /プロコン/u,
  /amiibo/i,
  /アミーボ/u,
];

const BONUS_PATTERNS = [
  /特典/u,
  /予約/u,
  /早期購入/u,
  /購入特典/u,
  /店舗特典/u,
  /限定/u,
  /付き/u,
];

const HARDWARE_KEYWORD_NAMES = new Set([
  "switch_handhelds",
  "psp_handhelds",
  "vita_handhelds",
  "nintendo_handhelds",
  "ps4",
  "ps3",
]);

const ITEM_STATUS_MATCHED = "matched";
const ITEM_STATUS_UNMATCHED = "unmatched";
const ITEM_STATUS_AMBIGUOUS = "ambiguous";
const ITEM_STATUS_BUNDLE = "bundle";

export type ItemMatchStatus =
  | typeof ITEM_STATUS_MATCHED
  | typeof ITEM_STATUS_UNMATCHED
  | typeof ITEM_STATUS_AMBIGUOUS
  | typeof ITEM_STATUS_BUNDLE;

interface CatalogMatcher {
  aliases: string[];
}

interface ItemSeed {
  slug: string;
  displayName: string;
  kind: "software" | "hardware";
  platform: string;
  series: string | null;
  targetBuyPrice: number | null;
  matchers: CatalogMatcher;
}

interface CompiledItem {
  id: string;
  slug: string;
  displayName: string;
  kind: "software" | "hardware";
  platform: string;
  series: string | null;
  targetBuyPrice: number | null;
  normalizedAliases: string[];
}

interface ListingForMatch {
  title: string;
  rawJson?: string | null;
  rawDetailJson?: string | null;
  keywordName?: string | null;
}

export interface ItemMatchResult {
  itemId: string | null;
  itemSlug: string | null;
  itemMatchStatus: ItemMatchStatus;
  itemSubfamily: string | null;
}

export interface ItemSyncResult {
  created: string[];
  updated: string[];
  disabled: string[];
}

interface SoftwareCsvRow {
  description: string;
  japaneseName: string;
  recommendedBuyPrice: string;
}

interface ParsedRawJson {
  categoryId?: string | number;
  name?: string;
}

interface ParsedRawDetail {
  description?: string;
  name?: string;
  meta_title?: string;
  data?: {
    description?: string;
    name?: string;
    meta_title?: string;
    item_category?: { id?: number; name?: string };
    item_category_ntiers?: { id?: number; name?: string };
  };
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"`’‘“”]/g, "")
    .replace(/[「」『』【】\[\]\(\){}]/g, "")
    .replace(/[&＆]/g, "and")
    .replace(/[+＋]/g, "plus")
    .replace(/[.,，。!！?:：/／\\|・･\-‐‑–—_]/g, "")
    .replace(/\s+/g, "");
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/pokernon/g, "pokemon")
    .replace(/pokerman/g, "pokemon")
    .replace(/wondar/g, "wonder")
    .replace(/mano/g, "mario")
    .replace(/marlo/g, "mario")
    .replace(/kirbys/g, "kirby")
    .replace(/zelda2/g, "zelda")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseSoftwareCsv(content: string): SoftwareCsvRow[] {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  return lines.slice(1).map((line) => {
    const [description = "", japaneseName = "", , recommendedBuyPrice = ""] = parseCsvLine(line);
    return { description, japaneseName, recommendedBuyPrice };
  });
}

function parseBuyPrice(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const numeric = Number.parseInt(digits, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function detectSeries(description: string): string | null {
  const normalized = description.toLowerCase();
  if (normalized.startsWith("pokemon")) return "Pokemon";
  if (normalized.startsWith("super mario") || normalized.startsWith("mario ")) return "Mario";
  if (normalized.startsWith("kirby")) return "Kirby";
  if (normalized.includes("zelda")) return "Zelda";
  if (normalized.includes("minecraft")) return "Minecraft";
  if (normalized.includes("donkey kong")) return "Donkey Kong";
  return null;
}

function createSoftwareSeed(params: {
  slug: string;
  displayName: string;
  japaneseName: string;
  targetBuyPrice: number | null;
  platform?: string;
  aliases?: string[];
}): ItemSeed {
  const aliases = uniqueStrings([
    params.displayName,
    params.japaneseName,
    ...(params.aliases ?? []),
  ]);

  return {
    slug: params.slug,
    displayName: params.displayName,
    kind: "software",
    platform: params.platform ?? (params.displayName.startsWith("NS2 ") ? "Nintendo Switch 2" : "Nintendo Switch"),
    series: detectSeries(params.displayName),
    targetBuyPrice: params.targetBuyPrice,
    matchers: { aliases },
  };
}

function buildSoftwareSeeds(row: SoftwareCsvRow): ItemSeed[] {
  const targetBuyPrice = parseBuyPrice(row.recommendedBuyPrice);
  const description = row.description.trim();
  const japaneseName = row.japaneseName.trim();

  if (description === "Super Marlo Party Mano Party 2 Superstars") {
    return [
      createSoftwareSeed({
        slug: "super-mario-party",
        displayName: "Super Mario Party",
        japaneseName: "スーパーマリオパーティ",
        targetBuyPrice,
        aliases: ["Super Mario Party"],
      }),
      createSoftwareSeed({
        slug: "mario-party-superstars",
        displayName: "Mario Party Superstars",
        japaneseName: "マリオパーティ スーパースターズ",
        targetBuyPrice,
        aliases: ["Mario Party Superstars", "マリオパーティスーパースターズ"],
      }),
    ];
  }

  const slug = slugify(description);
  const aliases = [japaneseName];

  if (slug === "mario-kart-8") {
    aliases.push("マリオカート8デラックス", "マリオカート８デラックス", "Mario Kart 8 Deluxe");
  }
  if (slug === "super-smash-bros") {
    aliases.push("スマブラ", "スマブラSP", "スマブラspecial");
  }
  if (slug === "sports") {
    aliases.push("Nintendo Switch Sports", "Switch Sports", "スイッチスポーツ");
  }
  if (slug === "super-mario-odyssey") {
    aliases.push("スーパーマリオオデッセイ");
  }
  if (slug === "animal-crossing-new-horizons") {
    aliases.push("あつまれどうぶつの森");
  }
  if (slug === "new-super-mario-bros-u") {
    aliases.push("NewスーパーマリオブラザーズUデラックス", "New スーパーマリオブラザーズ U デラックス");
  }
  if (slug === "ns2-super-mario-party-jamboree-tv") {
    aliases.push("スーパーマリオパーティジャンボリーNintendo Switch 2 Edition", "ジャンボリーTV");
  }

  return [
    createSoftwareSeed({
      slug,
      displayName: description,
      japaneseName,
      targetBuyPrice,
      aliases,
    }),
  ];
}

interface HardwareCatalogFile {
  items?: Array<{
    slug?: string;
    display_name?: string;
    kind?: string;
    platform?: string;
    series?: string;
    aliases?: string[];
  }>;
}

async function loadSoftwareSeedsFromDisk(): Promise<ItemSeed[]> {
  const content = await fs.readFile(SOFTWARE_CSV_PATH, "utf8");
  return parseSoftwareCsv(content).flatMap(buildSoftwareSeeds);
}

async function loadHardwareSeedsFromDisk(): Promise<ItemSeed[]> {
  const raw = YAML.parse(await fs.readFile(HARDWARE_CATALOG_PATH, "utf8")) as HardwareCatalogFile;
  return (raw.items ?? [])
    .filter((item): item is NonNullable<HardwareCatalogFile["items"]>[number] => Boolean(item?.slug && item.display_name && item.kind && item.platform))
    .map((item) => ({
      slug: item.slug!,
      displayName: item.display_name!,
      kind: item.kind as "hardware",
      platform: item.platform!,
      series: item.series ?? null,
      targetBuyPrice: null,
      matchers: { aliases: item.aliases ?? [] },
    }));
}

export async function loadItemSeedsFromDisk(): Promise<ItemSeed[]> {
  return [...await loadSoftwareSeedsFromDisk(), ...await loadHardwareSeedsFromDisk()];
}

export async function syncItemsFromDisk(
  prisma: PrismaClient,
): Promise<ItemSyncResult> {
  const seeds = await loadItemSeedsFromDisk();
  const existing = await prisma.item.findMany();
  const existingBySlug = new Map(existing.map((item) => [item.slug, item]));
  const seedSlugs = new Set(seeds.map((seed) => seed.slug));
  const result: ItemSyncResult = { created: [], updated: [], disabled: [] };

  for (const seed of seeds) {
    const current = existingBySlug.get(seed.slug);
    if (current) {
      await prisma.item.update({
        where: { slug: seed.slug },
        data: {
          displayName: seed.displayName,
          kind: seed.kind,
          platform: seed.platform,
          series: seed.series,
          targetBuyPrice: seed.targetBuyPrice,
          enabled: true,
          matchers: seed.matchers as unknown as Prisma.InputJsonValue,
        },
      });
      result.updated.push(seed.slug);
    } else {
      await prisma.item.create({
        data: {
          slug: seed.slug,
          displayName: seed.displayName,
          kind: seed.kind,
          platform: seed.platform,
          series: seed.series,
          targetBuyPrice: seed.targetBuyPrice,
          enabled: true,
          matchers: seed.matchers as unknown as Prisma.InputJsonValue,
        },
      });
      result.created.push(seed.slug);
    }
  }

  for (const item of existing) {
    if (!seedSlugs.has(item.slug) && item.enabled) {
      await prisma.item.update({
        where: { id: item.id },
        data: { enabled: false },
      });
      result.disabled.push(item.slug);
    }
  }

  return result;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildSearchTexts(listing: ListingForMatch): { normalizedTitle: string; normalizedDetail: string; detailText: string } {
  const rawJson = parseJson<ParsedRawJson>(listing.rawJson);
  const rawDetail = parseJson<ParsedRawDetail>(listing.rawDetailJson);

  const detailText = [
    listing.title,
    rawJson?.name,
    rawDetail?.name,
    rawDetail?.meta_title,
    rawDetail?.data?.name,
    rawDetail?.data?.description,
    rawDetail?.description,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  return {
    normalizedTitle: normalizeForMatch(listing.title),
    normalizedDetail: normalizeForMatch(detailText),
    detailText,
  };
}

function extractItemCategoryId(listing: ListingForMatch): number | null {
  const rawJson = parseJson<ParsedRawJson>(listing.rawJson);
  const rawDetail = parseJson<ParsedRawDetail>(listing.rawDetailJson);
  const candidate = rawDetail?.data?.item_category_ntiers?.id
    ?? rawDetail?.data?.item_category?.id
    ?? rawJson?.categoryId;

  if (typeof candidate === "number") return candidate;
  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function matchSoftwareItem(
  items: CompiledItem[],
  normalizedTitle: string,
  title: string,
): ItemMatchResult | null {
  const hasMerchSignals = MERCH_PATTERNS.some((pattern) => pattern.test(title))
    || ACCESSORY_PATTERNS.some((pattern) => pattern.test(title));
  const hasBonusSignals = BONUS_PATTERNS.some((pattern) => pattern.test(title));
  const matches = items
    .map((item) => ({
      item,
      bestAliasLength: Math.max(
        0,
        ...item.normalizedAliases
          .filter((alias) => alias.length > 0 && normalizedTitle.includes(alias))
          .map((alias) => alias.length),
      ),
    }))
    .filter((entry) => entry.bestAliasLength > 0)
    .sort((a, b) => b.bestAliasLength - a.bestAliasLength);

  if (matches.length === 0) return null;

  const distinctSlugs = uniqueStrings(matches.map((entry) => entry.item.slug));
  if (distinctSlugs.length > 1 || BUNDLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return {
      itemId: null,
      itemSlug: null,
      itemMatchStatus: ITEM_STATUS_BUNDLE,
      itemSubfamily: null,
    };
  }

  if (hasMerchSignals && hasBonusSignals) {
    return {
      itemId: null,
      itemSlug: null,
      itemMatchStatus: ITEM_STATUS_BUNDLE,
      itemSubfamily: null,
    };
  }

  if (hasMerchSignals) {
    return {
      itemId: null,
      itemSlug: null,
      itemMatchStatus: ITEM_STATUS_UNMATCHED,
      itemSubfamily: null,
    };
  }

  return {
    itemId: matches[0]!.item.id,
    itemSlug: matches[0]!.item.slug,
    itemMatchStatus: ITEM_STATUS_MATCHED,
    itemSubfamily: null,
  };
}

function shouldAttemptHardwareMatch(keywordName?: string | null): boolean {
  return keywordName != null && HARDWARE_KEYWORD_NAMES.has(keywordName);
}

function pickHardwareItem(
  items: CompiledItem[],
  normalizedDetail: string,
  keywordName?: string | null,
  categoryId?: number | null,
): CompiledItem | null {
  const titleMatches = items
    .map((item) => ({
      item,
      bestAliasLength: Math.max(
        0,
        ...item.normalizedAliases
          .filter((alias) => alias.length > 0 && normalizedDetail.includes(alias))
          .map((alias) => alias.length),
      ),
    }))
    .filter((entry) => entry.bestAliasLength > 0)
    .sort((a, b) => b.bestAliasLength - a.bestAliasLength);

  if (titleMatches.length > 0) {
    const best = titleMatches[0]!;
    const tied = titleMatches.filter((entry) => entry.bestAliasLength === best.bestAliasLength);
    if (tied.length === 1) {
      return best.item;
    }
    return null;
  }

  switch (keywordName) {
    case "switch_handhelds":
      if (categoryId === 701 || categoryId === 7015) {
        return items.find((item) => item.slug === "switch_standard") ?? null;
      }
      break;
    case "psp_handhelds":
      return null;
    case "vita_handhelds":
      return null;
    case "nintendo_handhelds":
      return null;
    case "ps4":
      return items.find((item) => item.slug === "ps4_base") ?? null;
    default:
      break;
  }

  return null;
}

function extractHardwareSubfamily(slug: string, detailText: string): string | null {
  const fullText = detailText.normalize("NFKC");

  if (slug.startsWith("switch_")) {
    if (/HAC[- ]?001\(?-?01\)?/i.test(fullText)) return "HAC-001(-01)";
    if (/HAC[- ]?001/i.test(fullText)) return "HAC-001";
    if (/HEG[- ]?001/i.test(fullText)) return "HEG-001";
    if (/HDH[- ]?001/i.test(fullText)) return "HDH-001";
    if (/バッテリー強化/u.test(fullText)) return "battery-revised";
  }

  const modelRegexes = [
    /CUH[- ]?\d{4}[A-Z]?/i,
    /CECH[- ]?[A-Z]?\d{4}[A-Z]?/i,
    /PCH[- ]?\d{4}[A-Z]?/i,
    /PSP[- ]?\d{4}[A-Z]*/i,
    /RED[- ]?001/i,
    /SPR[- ]?001/i,
    /KTR[- ]?001/i,
    /JAN[- ]?001/i,
    /FTR[- ]?001/i,
  ];

  for (const regex of modelRegexes) {
    const match = fullText.match(regex);
    if (match?.[0]) {
      return match[0].replace(/\s+/g, "").toUpperCase();
    }
  }

  return null;
}

export function classifyListing(
  listing: ListingForMatch,
  items: CompiledItem[],
): ItemMatchResult {
  const { normalizedTitle, normalizedDetail, detailText } = buildSearchTexts(listing);
  const softwareItems = items.filter((item) => item.kind === "software");
  const hardwareItems = items.filter((item) => item.kind === "hardware");

  const softwareMatch = matchSoftwareItem(softwareItems, normalizedTitle, listing.title);
  if (softwareMatch) {
    return softwareMatch;
  }

  if (!shouldAttemptHardwareMatch(listing.keywordName)) {
    return {
      itemId: null,
      itemSlug: null,
      itemMatchStatus: ITEM_STATUS_UNMATCHED,
      itemSubfamily: null,
    };
  }

  const categoryId = extractItemCategoryId(listing);
  const hardwareItem = pickHardwareItem(hardwareItems, normalizedDetail, listing.keywordName, categoryId);
  if (hardwareItem) {
    return {
      itemId: hardwareItem.id,
      itemSlug: hardwareItem.slug,
      itemMatchStatus: ITEM_STATUS_MATCHED,
      itemSubfamily: extractHardwareSubfamily(hardwareItem.slug, detailText),
    };
  }

  return {
    itemId: null,
    itemSlug: null,
    itemMatchStatus: ITEM_STATUS_UNMATCHED,
    itemSubfamily: null,
  };
}

export async function loadCompiledItems(prisma: PrismaClient): Promise<CompiledItem[]> {
  const items = await prisma.item.findMany({
    where: { enabled: true },
    orderBy: { displayName: "asc" },
  });

  return items.map((item) => {
    const matchers = item.matchers as unknown as CatalogMatcher;
    return {
      id: item.id,
      slug: item.slug,
      displayName: item.displayName,
      kind: item.kind as "software" | "hardware",
      platform: item.platform,
      series: item.series,
      targetBuyPrice: item.targetBuyPrice == null ? null : Number(item.targetBuyPrice),
      normalizedAliases: uniqueStrings((matchers.aliases ?? []).map(normalizeForMatch)),
    };
  });
}

export async function backfillListingItems(
  prisma: PrismaClient,
  batchSize = 250,
): Promise<{ scanned: number; updated: number }> {
  const items = await loadCompiledItems(prisma);
  let scanned = 0;
  let updated = 0;
  let cursorId: string | null = null;

  while (true) {
    const listings: Prisma.ListingGetPayload<{
      include: {
        keyword: {
          select: { name: true };
        };
      };
    }>[] = await prisma.listing.findMany({
      take: batchSize,
      ...(cursorId
        ? {
          skip: 1,
          cursor: { id: cursorId },
        }
        : {}),
      orderBy: { id: "asc" },
      include: {
        keyword: {
          select: { name: true },
        },
      },
    });

    if (listings.length === 0) break;

    const updates = listings.flatMap((listing) => {
        const match = classifyListing(
          {
            title: listing.title,
            rawJson: listing.rawJson,
            rawDetailJson: listing.rawDetailJson,
            keywordName: listing.keyword?.name ?? null,
          },
          items,
        );

        scanned += 1;
        const changed = listing.itemId !== match.itemId
          || listing.itemMatchStatus !== match.itemMatchStatus
          || listing.itemSubfamily !== match.itemSubfamily;

        if (!changed) {
          return [];
        }

        updated += 1;
        return [prisma.listing.update({
          where: { id: listing.id },
          data: {
            itemId: match.itemId,
            itemMatchStatus: match.itemMatchStatus,
            itemSubfamily: match.itemSubfamily,
          },
        })];
      });

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }

    cursorId = listings[listings.length - 1]!.id;
  }

  return { scanned, updated };
}
