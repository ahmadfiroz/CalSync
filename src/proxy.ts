import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const tokenEarly = request.cookies.get(SESSION_COOKIE)?.value;
  let sessionUserIdEarly: string | null = null;
  try {
    const payload = tokenEarly ? await verifySessionToken(tokenEarly) : null;
    sessionUserIdEarly = payload?.userId ?? null;
  } catch {
    sessionUserIdEarly = null;
  }

  if (path === "/login" && sessionUserIdEarly) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (path === "/login") {
    return NextResponse.next();
  }

  if (!sessionUserIdEarly) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (path !== "/") login.searchParams.set("from", path);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/api/me",
    "/api/config",
    "/api/sync",
    "/api/logout",
    "/api/calendars",
    "/api/calendars/:path*",
    "/api/events",
  ],
};
