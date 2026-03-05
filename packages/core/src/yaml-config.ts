import YAML from "yaml";
import { z } from "zod";

const yamlKeywordSpecSchema = z.union([
  z.string(),
  z.object({
    term: z.union([z.string(), z.array(z.string())]).optional(),
    search: z.union([z.string(), z.array(z.string())]).optional(),
    price_min: z.number().optional(),
    price_max: z.number().optional(),
    title_must_contain: z.union([z.string(), z.array(z.string())]).optional(),
    exclude_keyword: z.string().optional(),
    category_id: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    interval_sec: z.number().int().positive().optional(),
    topic: z.string().optional(),
  }),
]);

const yamlConfigSchema = z.object({
  keywords: z.record(z.string(), yamlKeywordSpecSchema).default({}),
});

export interface ParsedYamlKeyword {
  name: string;
  terms: string[];
  filters: {
    priceMin: number | null;
    priceMax: number | null;
    titleMustContain: string[];
    excludeKeyword: string | null;
    categoryId: number[];
  };
  intervalSec: number;
  topic: string | null;
}

function toTerms(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((t) => t.trim().length > 0);
  return [value].filter((t) => t.trim().length > 0);
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseYamlConfig(yamlContent: string): ParsedYamlKeyword[] {
  const raw = YAML.parse(yamlContent) as unknown;
  const config = yamlConfigSchema.parse(raw);
  const results: ParsedYamlKeyword[] = [];

  for (const [name, spec] of Object.entries(config.keywords)) {
    let terms: string[];
    let filters = {
      priceMin: null as number | null,
      priceMax: null as number | null,
      titleMustContain: [] as string[],
      excludeKeyword: null as string | null,
      categoryId: [] as number[],
    };
    let intervalSec = 60;
    let topic: string | null = null;

    if (typeof spec === "string") {
      terms = [spec];
    } else {
      terms = toTerms(spec.term ?? spec.search);
      const rawCat = spec.category_id;
      filters = {
        priceMin: spec.price_min ?? null,
        priceMax: spec.price_max ?? null,
        titleMustContain: toStringArray(spec.title_must_contain),
        excludeKeyword: spec.exclude_keyword ?? null,
        categoryId: rawCat == null ? [] : Array.isArray(rawCat) ? rawCat : [rawCat],
      };
      intervalSec = spec.interval_sec ?? 60;
      topic = spec.topic ?? null;
    }

    if (terms.length === 0) continue;

    results.push({ name, terms, filters, intervalSec, topic });
  }

  return results;
}
