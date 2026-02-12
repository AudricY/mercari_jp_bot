import fs from "node:fs/promises";
import path from "node:path";

import { createPrismaClient } from "@mercari-bot/db";
import YAML from "yaml";

interface LegacyKeywordSpec {
  term?: string | string[];
  search?: string | string[];
  price_min?: number;
  price_max?: number;
  title_must_contain?: string | string[];
  exclude_keyword?: string;
}

interface LegacyConfig {
  schedule?: {
    daily_summary_time?: string;
  };
  keywords?: Record<string, string | LegacyKeywordSpec>;
}

function toTerms(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((term) => term.trim().length > 0);
  }
  return [value].filter((term) => term.trim().length > 0);
}

function toTitleMustContain(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function main(): Promise<void> {
  const configPath = path.resolve(process.cwd(), "config.yaml");
  const file = await fs.readFile(configPath, "utf-8");
  const parsed = YAML.parse(file) as LegacyConfig;

  const prisma = createPrismaClient();

  const summaryTime = parsed.schedule?.daily_summary_time ?? "12:30";
  await prisma.systemConfig.upsert({
    where: { key: "daily_summary_time" },
    create: { key: "daily_summary_time", value: summaryTime },
    update: { value: summaryTime },
  });

  await prisma.systemConfig.upsert({
    where: { key: "display_timezone" },
    create: { key: "display_timezone", value: process.env.DISPLAY_TIMEZONE ?? "UTC" },
    update: { value: process.env.DISPLAY_TIMEZONE ?? "UTC" },
  });

  const keywords = parsed.keywords ?? {};

  for (const [name, spec] of Object.entries(keywords)) {
    let terms: string[] = [];
    let filters = {
      priceMin: null as number | null,
      priceMax: null as number | null,
      titleMustContain: [] as string[],
      excludeKeyword: null as string | null,
    };

    if (typeof spec === "string") {
      terms = [spec];
    } else {
      terms = toTerms(spec.term ?? spec.search);
      filters = {
        priceMin: typeof spec.price_min === "number" ? spec.price_min : null,
        priceMax: typeof spec.price_max === "number" ? spec.price_max : null,
        titleMustContain: toTitleMustContain(spec.title_must_contain),
        excludeKeyword: spec.exclude_keyword ?? null,
      };
    }

    if (terms.length === 0) {
      continue;
    }

    await prisma.keyword.upsert({
      where: { name },
      create: {
        name,
        enabled: true,
        terms,
        filters,
        intervalSec: 60,
      },
      update: {
        enabled: true,
        terms,
        filters,
      },
    });
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
