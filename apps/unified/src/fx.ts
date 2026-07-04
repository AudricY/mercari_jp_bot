import type { Logger } from "pino";

import { redactUnknown } from "@mercari-bot/core";

export interface FxRate {
  jpyPerUsd: number;
  source: "live" | "static" | "env";
  fetchedAt: Date;
}

const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=JPY";
const FX_TTL_MS = 12 * 60 * 60 * 1000;

let cached: FxRate | null = null;

/** Test hook. */
export function resetFxCache(): void {
  cached = null;
}

/**
 * USD→JPY rate for arbitrage math. Priority: ARBITRAGE_FX_JPY_PER_USD config
 * (manual pin, 0 = auto) → live rate from frankfurter.app cached 12h →
 * catalog fallback. Never throws: FX being briefly stale is fine, blocking
 * analytics is not.
 */
export async function getJpyPerUsd(params: { pin: number; fallback: number; logger: Logger }): Promise<FxRate> {
  const { pin, fallback, logger } = params;
  if (Number.isFinite(pin) && pin > 0) {
    return { jpyPerUsd: pin, source: "env", fetchedAt: new Date() };
  }

  if (cached && Date.now() - cached.fetchedAt.getTime() < FX_TTL_MS) {
    return cached;
  }

  try {
    const response = await fetch(FX_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`FX endpoint responded with ${response.status}`);
    }
    const data = (await response.json()) as { rates?: { JPY?: number } };
    const rate = data.rates?.JPY;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("FX endpoint returned no JPY rate");
    }
    cached = { jpyPerUsd: rate, source: "live", fetchedAt: new Date() };
    return cached;
  } catch (error) {
    logger.warn({ error: redactUnknown(error) }, "Live FX fetch failed; using fallback rate");
    // Keep serving a stale live rate over the static fallback if we have one.
    if (cached) {
      return cached;
    }
    return { jpyPerUsd: fallback, source: "static", fetchedAt: new Date() };
  }
}
