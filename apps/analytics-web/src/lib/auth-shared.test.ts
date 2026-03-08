import { describe, expect, it } from "vitest";

import { buildLoginRedirectPath, getAnalyticsAuthConfig, sanitizeNextPath } from "./auth-shared";

describe("analytics auth shared helpers", () => {
  it("reads auth config from env", () => {
    const config = getAnalyticsAuthConfig({
      ANALYTICS_AUTH_USER: "owner",
      ANALYTICS_AUTH_PASSWORD: "secret-pass",
      ANALYTICS_SESSION_PASSWORD: "12345678901234567890123456789012",
    });

    expect(config).toEqual({
      username: "owner",
      password: "secret-pass",
      sessionPassword: "12345678901234567890123456789012",
    });
  });

  it("returns null when auth env is incomplete", () => {
    expect(
      getAnalyticsAuthConfig({
        ANALYTICS_AUTH_USER: "owner",
        ANALYTICS_AUTH_PASSWORD: "secret-pass",
      }),
    ).toBeNull();
  });

  it("returns null when the session password is too short", () => {
    expect(
      getAnalyticsAuthConfig({
        ANALYTICS_AUTH_USER: "owner",
        ANALYTICS_AUTH_PASSWORD: "secret-pass",
        ANALYTICS_SESSION_PASSWORD: "too-short",
      }),
    ).toBeNull();
  });

  it("sanitizes redirect targets", () => {
    expect(sanitizeNextPath("/keywords/abc?granularity=day")).toBe("/keywords/abc?granularity=day");
    expect(sanitizeNextPath("https://example.com")).toBe("/");
    expect(sanitizeNextPath("//evil.example")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });

  it("builds login redirects that preserve safe next paths", () => {
    expect(buildLoginRedirectPath("/")).toBe("/login");
    expect(buildLoginRedirectPath("/keywords/abc?sort=cheapest")).toBe(
      "/login?next=%2Fkeywords%2Fabc%3Fsort%3Dcheapest",
    );
  });
});
