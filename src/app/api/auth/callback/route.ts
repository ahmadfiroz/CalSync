import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_INTENT_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/constants";
import {
  exchangeCodeForTokens,
  fetchGoogleUserProfile,
  publicBaseUrl,
} from "@/lib/google";
import { EMPTY_STORE, type CalSyncStore } from "@/lib/store";
import {
  createUser,
  normalizeIdentityKey,
  readStoreForUser,
  resolveUserIdByIdentityKey,
  writeStoreForUser,
} from "@/lib/store-db";
import {
  createSessionToken,
  isEmailAllowed,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  const oauthIntent = jar.get(OAUTH_INTENT_COOKIE)?.value;
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
    const profile = await fetchGoogleUserProfile(oauth2);
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

    const identityKey =
      email?.trim() ||
      (typeof profile.id === "string" ? `google:${profile.id}` : "");
    if (!identityKey) {
      throw new Error("Google did not return an email or account id.");
    }

    const normalizedLoginKey = normalizeIdentityKey(identityKey);

    const sessionToken = jar.get(SESSION_COOKIE)?.value;
    const sessionPayload = sessionToken
      ? await verifySessionToken(sessionToken)
      : null;

    const isAddIntent = oauthIntent === "add";
    let targetUserId: string;

    if (isAddIntent) {
      if (!sessionPayload?.userId) {
        return NextResponse.redirect(
          new URL(
            "/login?error=" +
              encodeURIComponent(
                "Sign in before adding another Google account."
              ),
            base
          )
        );
      }
      const existingOwner = await resolveUserIdByIdentityKey(normalizedLoginKey);
      if (existingOwner && existingOwner !== sessionPayload.userId) {
        return NextResponse.redirect(
          new URL(
            "/login?error=" +
              encodeURIComponent(
                "This Google account is already linked to another CalSync user."
              ),
            base
          )
        );
      }
      targetUserId = sessionPayload.userId;
    } else {
      const existingOwner = await resolveUserIdByIdentityKey(normalizedLoginKey);
      if (existingOwner) {
        targetUserId = existingOwner;
      } else {
        targetUserId = await createUser();
      }
    }

    const prev =
      (await readStoreForUser(targetUserId)) ??
      ({ ...EMPTY_STORE } satisfies CalSyncStore);

    let accounts = [...prev.accounts];
    const existingIdx = email ? accounts.findIndex((a) => a.email === email) : -1;
    let newAcc: { id: string; refreshToken: string; email?: string };
    if (existingIdx >= 0) {
      // Re-auth: preserve the existing account ID so mirror rules stay valid
      newAcc = { ...accounts[existingIdx], refreshToken: rt };
      accounts[existingIdx] = newAcc;
    } else {
      newAcc = { id: randomUUID(), refreshToken: rt, email };
      accounts.push(newAcc);
    }

    const extraIdentityKeys: string[] = [];
    if (!email?.trim() && typeof profile.id === "string") {
      extraIdentityKeys.push(`google:${profile.id}`);
    }

    await writeStoreForUser(
      targetUserId,
      {
        version: 3,
        accounts,
        mirrorRules: prev.mirrorRules ?? [],
        calendarWatchChannels: prev.calendarWatchChannels,
      },
      extraIdentityKeys
    );

    const loginDisplay = email?.trim() || identityKey;
    const res = NextResponse.redirect(new URL("/", base));
    const newSession = await createSessionToken(targetUserId, loginDisplay);
    res.cookies.set(SESSION_COOKIE, newSession, sessionCookieOptions);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(msg)}`, base)
    );
  }
}
