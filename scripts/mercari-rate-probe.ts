#!/usr/bin/env tsx
/*
 * Estimate the current Mercari search rate-limit threshold.
 *
 * Recommended production use:
 *   1. Stop the app so scheduler traffic does not contaminate the probe:
 *      docker compose stop app
 *   2. Run this from the image or repo host:
 *      pnpm run probe:mercari-rate -- --duration-sec 120 --delays-ms 3000,2500,2000,1750,1500,1250,1000
 *   3. Restart the app:
 *      docker compose start app
 *
 * This cannot prove a permanent exact limit. It estimates the current safe
 * ceiling for this IP/session/request shape and stops on the first 429 by
 * default to avoid digging into a longer cooldown.
 */

import { MercariApiError, scanMercariTerm } from "@mercari-bot/core";

interface ProbeOptions {
  delaysMs: number[];
  durationSec: number;
  maxRequestsPerPhase: number;
  cooldownAfter429Sec: number;
  continueAfter429: boolean;
  term: string;
  categoryId: number[];
  priceMax: number | null;
  pageSize: number;
}

interface ProbeResult {
  delayMs: number;
  attempted: number;
  succeeded: number;
  rateLimited: number;
  failed: number;
  elapsedMs: number;
  latenciesMs: number[];
  statusCodes: Map<string, number>;
  first429AtRequest: number | null;
}

const DEFAULT_DELAYS_MS = [3000, 2500, 2000, 1750, 1500, 1250, 1000];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log("Mercari rate probe");
  console.log(`term=${JSON.stringify(options.term)} categoryId=${options.categoryId.join(",") || "none"} pageSize=${options.pageSize}`);
  console.log(`durationSec=${options.durationSec} maxRequestsPerPhase=${options.maxRequestsPerPhase}`);
  console.log(`delaysMs=${options.delaysMs.join(",")}`);
  console.log("");

  const results: ProbeResult[] = [];

  for (const delayMs of options.delaysMs) {
    const result = await runPhase(delayMs, options);
    results.push(result);
    printPhase(result);

    if (result.rateLimited > 0 && !options.continueAfter429) {
      console.log("");
      console.log(`Stopped after first rate-limited phase. Cooling down for ${options.cooldownAfter429Sec}s before exit.`);
      await sleep(options.cooldownAfter429Sec * 1000);
      break;
    }

    await sleep(Math.max(delayMs, 1000));
  }

  printSummary(results);
}

async function runPhase(delayMs: number, options: ProbeOptions): Promise<ProbeResult> {
  const result: ProbeResult = {
    delayMs,
    attempted: 0,
    succeeded: 0,
    rateLimited: 0,
    failed: 0,
    elapsedMs: 0,
    latenciesMs: [],
    statusCodes: new Map(),
    first429AtRequest: null,
  };

  const phaseStartedAt = Date.now();
  const phaseEndsAt = phaseStartedAt + options.durationSec * 1000;

  while (Date.now() < phaseEndsAt && result.attempted < options.maxRequestsPerPhase) {
    const requestStartedAt = Date.now();
    result.attempted += 1;

    try {
      await scanMercariTerm({
        term: options.term,
        filters: {
          priceMin: null,
          priceMax: options.priceMax,
          titleMustContain: [],
          excludeKeyword: null,
          categoryId: options.categoryId,
        },
        timeoutMs: 15000,
        maxItems: options.pageSize,
      });
      result.succeeded += 1;
      increment(result.statusCodes, "200");
    } catch (error) {
      const statusCode = statusCodeOf(error);
      increment(result.statusCodes, statusCode ?? "unknown");

      if (statusCode === "429") {
        result.rateLimited += 1;
        result.first429AtRequest ??= result.attempted;
        result.latenciesMs.push(Date.now() - requestStartedAt);
        break;
      }

      result.failed += 1;
    }

    result.latenciesMs.push(Date.now() - requestStartedAt);

    const waitMs = delayMs - (Date.now() - requestStartedAt);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  result.elapsedMs = Date.now() - phaseStartedAt;
  return result;
}

function printPhase(result: ProbeResult) {
  const requestsPerMin = result.elapsedMs > 0 ? (result.attempted / result.elapsedMs) * 60_000 : 0;
  const p50 = percentile(result.latenciesMs, 0.5);
  const p95 = percentile(result.latenciesMs, 0.95);
  const statuses = [...result.statusCodes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");

  console.log([
    `delay=${result.delayMs}ms`,
    `rpm=${requestsPerMin.toFixed(1)}`,
    `attempted=${result.attempted}`,
    `ok=${result.succeeded}`,
    `429=${result.rateLimited}`,
    `failed=${result.failed}`,
    `p50=${p50}ms`,
    `p95=${p95}ms`,
    `statuses=[${statuses}]`,
    result.first429AtRequest ? `first429At=${result.first429AtRequest}` : "",
  ].filter(Boolean).join(" "));
}

function printSummary(results: ProbeResult[]) {
  const clean = results.filter((result) => result.rateLimited === 0 && result.failed === 0);
  const firstLimited = results.find((result) => result.rateLimited > 0);
  const fastestClean = clean.at(-1);

  console.log("");
  console.log("Summary");
  if (fastestClean) {
    const rpm = (fastestClean.attempted / fastestClean.elapsedMs) * 60_000;
    console.log(`fastestCleanDelayMs=${fastestClean.delayMs} estimatedCleanRpm=${rpm.toFixed(1)}`);
  } else {
    console.log("fastestCleanDelayMs=none");
  }

  if (firstLimited) {
    const rpm = (firstLimited.attempted / firstLimited.elapsedMs) * 60_000;
    console.log(`firstRateLimitedDelayMs=${firstLimited.delayMs} estimatedLimitedRpm=${rpm.toFixed(1)}`);
  } else {
    console.log("firstRateLimitedDelayMs=none");
  }

  console.log("Use the fastest clean delay with a safety margin, not the first failing delay.");
}

function parseArgs(args: string[]): ProbeOptions {
  const values = new Map<string, string | true>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey!;
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }

    values.set(key, next);
    i += 1;
  }

  if (values.has("help")) {
    printHelp();
    process.exit(0);
  }

  return {
    delaysMs: parseDelays(readString(values, "delays-ms") ?? DEFAULT_DELAYS_MS.join(",")),
    durationSec: readPositiveInt(values, "duration-sec", 120),
    maxRequestsPerPhase: readPositiveInt(values, "max-requests-per-phase", 200),
    cooldownAfter429Sec: readPositiveInt(values, "cooldown-after-429-sec", 180),
    continueAfter429: values.has("continue-after-429"),
    term: readString(values, "term") ?? "ゼルダの伝説 Switch",
    categoryId: parseNumberList(readString(values, "category-id") ?? "702"),
    priceMax: readOptionalPositiveInt(values, "price-max", 5000),
    pageSize: readPositiveInt(values, "page-size", 1),
  };
}

function printHelp() {
  console.log(`Usage:
  pnpm run probe:mercari-rate -- [options]

Options:
  --delays-ms 3000,2500,2000   Delay ladder to test, fastest last
  --duration-sec 120           Seconds per phase
  --max-requests-per-phase 200 Hard cap per phase
  --cooldown-after-429-sec 180 Cooldown before exit after first 429
  --continue-after-429         Continue testing lower delays after a 429
  --term "ゼルダの伝説 Switch" Search term
  --category-id 702            Comma-separated category IDs; empty string for none
  --price-max 5000             Price max; empty string for none
  --page-size 1                Mercari pageSize per request
`);
}

function parseDelays(value: string): number[] {
  const delays = parseNumberList(value);
  if (delays.length === 0) {
    throw new Error("--delays-ms must contain at least one delay");
  }
  return delays;
}

function parseNumberList(value: string): number[] {
  if (value.trim() === "") {
    return [];
  }
  return value.split(",").map((part) => {
    const parsed = Number.parseInt(part.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid numeric list value: ${part}`);
    }
    return parsed;
  });
}

function readString(values: Map<string, string | true>, key: string): string | null {
  const value = values.get(key);
  if (value === undefined) {
    return null;
  }
  if (value === true) {
    throw new Error(`--${key} requires a value`);
  }
  return value;
}

function readPositiveInt(values: Map<string, string | true>, key: string, fallback: number): number {
  const value = readString(values, key);
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return parsed;
}

function readOptionalPositiveInt(values: Map<string, string | true>, key: string, fallback: number | null): number | null {
  const value = readString(values, key);
  if (value === null) {
    return fallback;
  }
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer or an empty string`);
  }
  return parsed;
}

function statusCodeOf(error: unknown): string | null {
  if (error instanceof MercariApiError) {
    return String(error.statusCode);
  }
  if (error instanceof Error) {
    const match = error.message.match(/responded with (\d{3})/);
    return match?.[1] ?? null;
  }
  return null;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile));
  return sorted[index]!;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
