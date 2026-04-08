import { calendar } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];

export function getOAuthClient() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = `${publicBaseUrl()}/api/auth/callback`;
  if (!id || !secret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  return new OAuth2Client(id, secret, redirect);
}

export function publicBaseUrl() {
  const u = process.env.CALSYNC_PUBLIC_URL || "http://localhost:3000";
  return u.replace(/\/$/, "");
}

export function getAuthUrl(
  state: string,
  opts?: { selectAccount?: boolean }
) {
  const oauth2 = getOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: opts?.selectAccount ? "consent select_account" : "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. Revoke app access in Google Account settings and sign in again (use prompt=consent)."
    );
  }
  return { oauth2, tokens };
}

export async function fetchGoogleUserProfile(oauth2: OAuth2Client) {
  const { token } = await oauth2.getAccessToken();
  if (!token) {
    throw new Error("No access token from Google OAuth.");
  }
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`);
  }
  return (await res.json()) as { email?: string; id?: string };
}

export function getCalendarClient(refreshToken: string) {
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return calendar({ version: "v3", auth: oauth2 });
}
