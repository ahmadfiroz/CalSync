import { resolveUserIdByIdentityKey } from "@/lib/store-db";

export const SESSION_COOKIE = "calsync_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  userId: string;
  loginEmail?: string;
};

function getSessionSecret(): string {
  const s = process.env.CALSYNC_SESSION_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV !== "production") {
    return "dev-calsync-session-secret-change-in-production";
  }
  throw new Error("CALSYNC_SESSION_SECRET is required in production");
}

export function parseAllowedEmails(): Set<string> {
  const raw = process.env.CALSYNC_ALLOWED_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isEmailAllowed(email: string | undefined | null): boolean {
  const allowed = parseAllowedEmails();
  if (allowed.size === 0) return true;
  if (!email) return false;
  return allowed.has(email.trim().toLowerCase());
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function createSessionToken(
  userId: string,
  loginEmail?: string | null
): Promise<string> {
  const secret = getSessionSecret();
  const exp = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload: Record<string, unknown> = { u: userId, exp };
  if (loginEmail?.trim()) payload.e = loginEmail.trim();
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  return `${payloadPart}.${bufferToBase64Url(sig)}`;
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  const secret = getSessionSecret();
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payloadPart = token.slice(0, lastDot);
  const sigPart = token.slice(lastDot + 1);
  if (!payloadPart || !sigPart) return null;
  let payload: { u?: unknown; e?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    ) as { u?: unknown; e?: unknown; exp?: unknown };
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return null;
  }
  const key = await importHmacKey(secret);
  const sigBytes = base64UrlToBuffer(sigPart);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(sigBytes),
    new TextEncoder().encode(payloadPart)
  );
  if (!ok) return null;

  if (typeof payload.u === "string" && payload.u) {
    return {
      userId: payload.u,
      loginEmail:
        typeof payload.e === "string" && payload.e ? payload.e : undefined,
    };
  }

  if (typeof payload.e === "string" && payload.e) {
    try {
      const userId = await resolveUserIdByIdentityKey(payload.e);
      if (!userId) return null;
      return { userId, loginEmail: payload.e };
    } catch {
      return null;
    }
  }

  return null;
}

/** @deprecated use verifySessionToken */
export async function getSessionEmailFromCookieValue(
  value: string | undefined | null
): Promise<string | null> {
  if (!value) return null;
  const p = await verifySessionToken(value);
  return p?.loginEmail ?? null;
}

export async function getSessionPayloadFromCookies(jar: {
  get(name: string): { value?: string } | undefined;
}): Promise<SessionPayload | null> {
  const v = jar.get(SESSION_COOKIE)?.value;
  if (!v) return null;
  return verifySessionToken(v);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SEC,
};
