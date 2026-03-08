import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ANALYTICS_SESSION_COOKIE,
  getAnalyticsAuthConfig,
  sanitizeNextPath,
  type AnalyticsLoginPayload,
} from "./auth-shared";

export interface AnalyticsSessionData {
  isAuthenticated?: boolean;
  username?: string;
}

export function getAnalyticsSessionOptions(): SessionOptions {
  const config = getAnalyticsAuthConfig();
  if (!config) {
    throw new Error("Analytics auth is not configured");
  }

  return {
    cookieName: ANALYTICS_SESSION_COOKIE,
    password: config.sessionPassword,
    ttl: 60 * 60 * 24 * 7,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // This deployment is currently plain HTTP on the VPS, not behind TLS.
      secure: false,
    },
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function getAnalyticsSession() {
  const cookieStore = await cookies();
  return getIronSession<AnalyticsSessionData>(cookieStore, getAnalyticsSessionOptions());
}

export async function getAnalyticsSessionState() {
  const config = getAnalyticsAuthConfig();
  if (!config) {
    return {
      configured: false as const,
      isAuthenticated: false,
      username: null,
    };
  }

  const session = await getAnalyticsSession();
  return {
    configured: true as const,
    isAuthenticated: session.isAuthenticated === true,
    username: session.username ?? null,
  };
}

export async function requireAnalyticsSession() {
  const session = await getAnalyticsSession();

  if (session.isAuthenticated !== true) {
    redirect("/login");
  }

  return session;
}

export function validateAnalyticsCredentials(
  payload: AnalyticsLoginPayload,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const config = getAnalyticsAuthConfig(env);
  if (!config) {
    return false;
  }

  return safeEqual(payload.username, config.username) && safeEqual(payload.password, config.password);
}

export function getLoginDestination(value: string | null | undefined): string {
  return sanitizeNextPath(value);
}
