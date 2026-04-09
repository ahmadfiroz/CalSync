import { NextResponse } from "next/server";
import { isStoreConnected } from "@/lib/store";
import { readStoreForUser } from "@/lib/store-db";
import { requireUserId } from "@/lib/api-session";

export const runtime = "nodejs";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const s = await readStoreForUser(userId);
  if (!isStoreConnected(s)) {
    return NextResponse.json({ connected: false });
  }
  const accounts = s.accounts.map((a) => ({
    id: a.id,
    email: a.email ?? null,
  }));
  return NextResponse.json({
    connected: true,
    accounts,
    email: accounts[0]?.email ?? null,
  });
}
