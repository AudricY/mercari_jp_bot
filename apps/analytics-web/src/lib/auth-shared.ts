export const ANALYTICS_SESSION_COOKIE = "mercari_analytics_session";

export interface AnalyticsAuthConfig {
  username: string;
  password: string;
  sessionPassword: string;
}

export interface AnalyticsLoginPayload {
  username: string;
  password: string;
}

export function getAnalyticsAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AnalyticsAuthConfig | null {
  const username = env.ANALYTICS_AUTH_USER?.trim();
  const password = env.ANALYTICS_AUTH_PASSWORD;
  const sessionPassword = env.ANALYTICS_SESSION_PASSWORD;

  if (!username || !password || !sessionPassword || sessionPassword.length < 32) {
    return null;
  }

  return {
    username,
    password,
    sessionPassword,
  };
}

export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export function buildLoginRedirectPath(nextPath: string): string {
  const safeNextPath = sanitizeNextPath(nextPath);
  if (safeNextPath === "/") {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(safeNextPath)}`;
}
