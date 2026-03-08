import { NextResponse, type NextRequest } from "next/server";

import { ANALYTICS_SESSION_COOKIE, buildLoginRedirectPath, getAnalyticsAuthConfig } from "./lib/auth-shared";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!getAnalyticsAuthConfig()) {
    return new NextResponse("Analytics auth is not configured.", { status: 503 });
  }

  const sessionCookie = request.cookies.get(ANALYTICS_SESSION_COOKIE)?.value;
  if (sessionCookie) {
    return NextResponse.next();
  }

  const redirectUrl = new URL(buildLoginRedirectPath(`${pathname}${search}`), request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
