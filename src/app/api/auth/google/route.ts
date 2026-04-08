import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  OAUTH_INTENT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SEC,
} from "@/lib/constants";
import { getAuthUrl } from "@/lib/google";
import { readStoreForUser } from "@/lib/store-db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: OAUTH_STATE_MAX_AGE_SEC,
  path: "/",
};

export async function GET(req: NextRequest) {
  const addAccount = req.nextUrl.searchParams.get("add") === "1";
  const state = randomBytes(32).toString("hex");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, cookieOpts);
  if (addAccount) {
    jar.set(OAUTH_INTENT_COOKIE, "add", cookieOpts);
  } else {
    jar.delete(OAUTH_INTENT_COOKIE);
  }

  let accountCount = 0;
  const sessionTok = jar.get(SESSION_COOKIE)?.value;
  if (sessionTok) {
    const payload = await verifySessionToken(sessionTok);
    if (payload?.userId) {
      const s = await readStoreForUser(payload.userId);
      accountCount = s?.accounts.length ?? 0;
    }
  }

  const selectAccount = addAccount || accountCount > 0;
  const url = getAuthUrl(state, { selectAccount });
  return NextResponse.redirect(url);
}
