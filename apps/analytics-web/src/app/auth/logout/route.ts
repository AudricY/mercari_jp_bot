import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getIronSession } from "iron-session";

import { getAnalyticsAuthConfig } from "../../../lib/auth-shared";
import { getAnalyticsSessionOptions, type AnalyticsSessionData } from "../../../lib/auth";

export async function POST(request: Request) {
  const config = getAnalyticsAuthConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const cookieStore = await cookies();
  const session = await getIronSession<AnalyticsSessionData>(cookieStore, getAnalyticsSessionOptions());

  session.destroy();

  return NextResponse.redirect(new URL("/login", request.url), 303);
}
