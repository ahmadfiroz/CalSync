import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_INTENT_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/constants";
import { google } from "googleapis";
import { exchangeCodeForTokens, publicBaseUrl } from "@/lib/google";
import { readStore, writeStore } from "@/lib/store";
import {
  createSessionToken,
  isEmailAllowed,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  jar.delete(OAUTH_INTENT_COOKIE);

  const base = publicBaseUrl();

  if (err) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(err)}`, base)
    );
  }
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_state", base)
    );
  }

  try {
    const { oauth2, tokens } = await exchangeCodeForTokens(code);
    const rt = tokens.refresh_token!;
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const { data: profile } = await oauth2Api.userinfo.get();
    const email =
      typeof profile.email === "string" ? profile.email : undefined;

    if (!isEmailAllowed(email)) {
      return NextResponse.redirect(
        new URL(
          "/login?error=" +
            encodeURIComponent(
              "This Google account is not allowed to use this CalSync instance."
            ),
          base
        )
      );
    }

    const sessionSubject =
      email?.trim() ||
      (typeof profile.id === "string" ? `google:${profile.id}` : "");
    if (!sessionSubject) {
      throw new Error("Google did not return an email or account id.");
    }

    const prev = readStore() ?? {
      version: 3 as const,
      accounts: [],
      mirrorRules: [],
    };

    const newAcc = { id: randomUUID(), refreshToken: rt, email };

    let accounts = [...prev.accounts];
    if (email) {
      accounts = accounts.filter((a) => a.email !== email);
    }
    accounts.push(newAcc);

    writeStore({
      version: 3,
      accounts,
      mirrorRules: prev.mirrorRules,
      calendarWatchChannels: prev.calendarWatchChannels,
    });

    const res = NextResponse.redirect(new URL("/", base));
    const sessionToken = await createSessionToken(sessionSubject);
    res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(msg)}`, base)
    );
  }
}
