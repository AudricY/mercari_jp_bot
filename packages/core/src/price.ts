import type { ParsedPrice } from "./types.js";

const PRICE_PATTERN = /(¥|US\$|\$)\s*([\d,]+(?:\.\d+)?)/;

export function parsePrice(rawText: string): ParsedPrice | null {
  const match = rawText.match(PRICE_PATTERN);
  if (!match) {
    return null;
  }

  const symbol = match[1];
  const amountStr = match[2];
  if (!symbol || !amountStr) {
    return null;
  }

  const amount = Number.parseFloat(amountStr.replaceAll(",", ""));

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    currency: symbol,
    numericPrice: amount,
    displayPrice: `${symbol}${amountStr}`,
  };
}
