import { NextResponse } from "next/server";
import { readStore, isStoreConnected } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const s = readStore();
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
