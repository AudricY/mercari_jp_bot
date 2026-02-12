import { describe, expect, it } from "vitest";

import { buildDedupeKey, deriveSourceListingId } from "./dedupe.js";

describe("dedupe", () => {
  it("derives listing id from Mercari URL", () => {
    expect(deriveSourceListingId("https://jp.mercari.com/item/m123abc")).toBe("m123abc");
  });

  it("uses source id as primary dedupe key", () => {
    expect(
      buildDedupeKey({
        sourceListingId: "m123abc",
        url: "https://jp.mercari.com/item/m123abc",
        title: "PlayStation",
        imageUrl: "https://example.com/img.jpg",
      }),
    ).toBe("listing:m123abc");
  });
});
