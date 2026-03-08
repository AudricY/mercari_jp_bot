import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getIronSession } from "iron-session";

import { getAnalyticsAuthConfig, sanitizeNextPath } from "../../../lib/auth-shared";
import { getAnalyticsSessionOptions, type AnalyticsSessionData, validateAnalyticsCredentials } from "../../../lib/auth";

export async function POST(request: Request) {
  const config = getAnalyticsAuthConfig();
  if (!config) {
    return new NextResponse("Analytics auth is not configured.", { status: 503 });
  }

  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? "/"));

  if (!validateAnalyticsCredentials({ username, password })) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "invalid");
    if (nextPath !== "/") {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl, 303);
  }

  const cookieStore = await cookies();
  const session = await getIronSession<AnalyticsSessionData>(cookieStore, getAnalyticsSessionOptions());

  session.isAuthenticated = true;
  session.username = config.username;
  await session.save();

  return NextResponse.redirect(new URL(nextPath, request.url), 303);
}
