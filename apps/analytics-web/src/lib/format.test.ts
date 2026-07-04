import { describe, expect, it } from "vitest";

import { formatPrice, formatRelativeTime, formatSignedPrice } from "./format";

describe("formatSignedPrice", () => {
  it("prefixes positive spreads with +", () => {
    expect(formatSignedPrice(1500)).toBe("+¥1,500");
  });

  it("prefixes negative spreads with a minus sign", () => {
    expect(formatSignedPrice(-800)).toBe("−¥800");
  });

  it("renders zero without a sign", () => {
    expect(formatSignedPrice(0)).toBe("¥0");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-05T12:00:00Z");

  it("renders minutes ago", () => {
    expect(formatRelativeTime("2026-07-05T11:45:00Z", now)).toBe("15m ago");
  });

  it("renders hours ago", () => {
    expect(formatRelativeTime("2026-07-05T06:00:00Z", now)).toBe("6h ago");
  });

  it("renders days ago", () => {
    expect(formatRelativeTime("2026-07-01T12:00:00Z", now)).toBe("4d ago");
  });

  it("renders just now for very recent timestamps", () => {
    expect(formatRelativeTime("2026-07-05T11:59:40Z", now)).toBe("just now");
  });
});

describe("formatPrice", () => {
  it("formats JPY with the yen symbol", () => {
    expect(formatPrice(12800)).toBe("¥12,800");
  });
});
