import { afterEach, describe, expect, it, vi } from "vitest";

describe("analytics api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.ADMIN_TOKEN;
    delete process.env.ANALYTICS_API_URL;
  });

  it("sends the bearer token and forwarded-for header", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keywords: [], from: "", to: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getKeywords } = await import("./api");
    await getKeywords();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/keywords",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-admin-token",
          "X-Forwarded-For": "127.0.0.1",
        },
      }),
    );
  });
});
