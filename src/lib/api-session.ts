import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function requireUserId(): Promise<string | null> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const p = await verifySessionToken(t);
  return p?.userId ?? null;
}
