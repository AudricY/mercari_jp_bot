import { describe, expect, it } from "vitest";

import { formatPct, formatPrice, formatRelativeTime, formatSignedPrice, formatSignedUsd, formatUsd } from "./format";

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

describe("formatUsd", () => {
  it("formats with two decimals", () => {
    expect(formatUsd(12.3)).toBe("$12.30");
  });

  it("groups thousands", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("formats integers with .00", () => {
    expect(formatUsd(8)).toBe("$8.00");
  });
});

describe("formatSignedUsd", () => {
  it("prefixes positive margins with +", () => {
    expect(formatSignedUsd(5.8)).toBe("+$5.80");
  });

  it("prefixes negative margins with a minus sign", () => {
    expect(formatSignedUsd(-3.25)).toBe("−$3.25");
  });

  it("renders zero without a sign", () => {
    expect(formatSignedUsd(0)).toBe("$0.00");
  });
});

describe("formatPct", () => {
  it("formats with one decimal", () => {
    expect(formatPct(8.8)).toBe("8.8%");
  });

  it("pads whole numbers to one decimal", () => {
    expect(formatPct(30)).toBe("30.0%");
  });
});
