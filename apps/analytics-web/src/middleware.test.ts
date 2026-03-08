import { describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

vi.mock("./lib/auth-shared", async () => {
  const actual = await vi.importActual<typeof import("./lib/auth-shared")>("./lib/auth-shared");
  return {
    ...actual,
    getAnalyticsAuthConfig: vi.fn(() => ({
      username: "owner",
      password: "secret-pass",
      sessionPassword: "12345678901234567890123456789012",
    })),
  };
});

import { middleware } from "./middleware";

describe("analytics middleware", () => {
  it("redirects unauthenticated requests to login", () => {
    const request = new NextRequest("http://localhost:3001/keywords/abc?granularity=day");

    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login?next=%2Fkeywords%2Fabc%3Fgranularity%3Dday",
    );
  });

  it("allows public auth routes", () => {
    const request = new NextRequest("http://localhost:3001/login");

    const response = middleware(request);

    expect(response.status).toBe(200);
  });

  it("allows authenticated requests with the session cookie present", () => {
    const request = new NextRequest("http://localhost:3001/", {
      headers: {
        cookie: "mercari_analytics_session=sealed-value",
      },
    });

    const response = middleware(request);

    expect(response.status).toBe(200);
  });
});
