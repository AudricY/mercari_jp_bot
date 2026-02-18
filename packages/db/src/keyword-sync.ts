import type { PrismaClient } from "@prisma/client";

import type { ParsedYamlKeyword } from "@mercari-bot/core";

export interface SyncResult {
  created: string[];
  updated: string[];
  disabled: string[];
}

export async function syncKeywordsFromConfig(
  prisma: PrismaClient,
  keywords: ParsedYamlKeyword[],
): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], disabled: [] };

  const existing = await prisma.keyword.findMany();
  const existingByName = new Map(existing.map((k) => [k.name, k]));
  const yamlNames = new Set(keywords.map((k) => k.name));

  for (const kw of keywords) {
    const current = existingByName.get(kw.name);

    if (current) {
      await prisma.keyword.update({
        where: { name: kw.name },
        data: {
          enabled: true,
          terms: kw.terms,
          filters: kw.filters,
          intervalSec: kw.intervalSec,
        },
      });
      result.updated.push(kw.name);
    } else {
      await prisma.keyword.create({
        data: {
          name: kw.name,
          enabled: true,
          terms: kw.terms,
          filters: kw.filters,
          intervalSec: kw.intervalSec,
        },
      });
      result.created.push(kw.name);
    }
  }

  for (const row of existing) {
    if (!yamlNames.has(row.name) && row.enabled) {
      await prisma.keyword.update({
        where: { id: row.id },
        data: { enabled: false },
      });
      result.disabled.push(row.name);
    }
  }

  return result;
}
