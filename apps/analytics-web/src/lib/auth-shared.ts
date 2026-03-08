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

export function buildExternalUrl(request: Request, path: string): URL {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.split(",")[0]?.trim();
  const origin = forwardedHost
    ? `${forwardedProto ?? "http"}://${forwardedHost}`
    : host
      ? `${forwardedProto ?? new URL(request.url).protocol.replace(":", "")}://${host}`
      : new URL(request.url).origin;

  return new URL(path, origin);
}
