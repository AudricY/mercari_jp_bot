import { describe, expect, it } from "vitest";

import { parsePrice } from "./price.js";

describe("parsePrice", () => {
  it("parses JPY price", () => {
    const parsed = parsePrice("PS4 本体 ¥12,800");
    expect(parsed).toEqual({
      currency: "¥",
      numericPrice: 12800,
      displayPrice: "¥12,800",
    });
  });

  it("returns null for malformed input", () => {
    expect(parsePrice("no price here")).toBeNull();
  });
});
