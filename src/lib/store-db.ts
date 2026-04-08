import fs from "fs";
import path from "path";
import type { CalSyncStore, ConnectedAccount } from "./store";
import { normalizeParsed, isStoreConnected } from "./store";
import { getSupabaseServiceClient } from "./supabase-server";

const DATA_DIR = path.join(process.cwd(), ".data");
const LEGACY_STORE_FILE = path.join(DATA_DIR, "store.json");

let migrationChecked = false;

export function normalizeIdentityKey(emailOrSubject: string): string {
  const t = emailOrSubject.trim();
  if (t.includes("@")) return t.toLowerCase();
  return t;
}

function identityKeysFromAccounts(accounts: ConnectedAccount[]): string[] {
  const keys: string[] = [];
  for (const a of accounts) {
    if (a.email?.trim()) keys.push(normalizeIdentityKey(a.email));
  }
  return keys;
}

async function syncWatchChannelIndex(
  userId: string,
  channels: CalSyncStore["calendarWatchChannels"]
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase.from("calsync_watch_channels").delete().eq("user_id", userId);
  if (!channels?.length) return;
  const rows = channels.map((ch) => ({
    channel_id: ch.channelId,
    user_id: userId,
  }));
  const { error } = await supabase.from("calsync_watch_channels").insert(rows);
  if (error) throw new Error(error.message);
}

async function syncIdentitiesFromAccounts(
  userId: string,
  accounts: ConnectedAccount[],
  extraIdentityKeys: string[] = []
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase.from("calsync_identities").delete().eq("user_id", userId);
  const keySet = new Set<string>();
  for (const k of identityKeysFromAccounts(accounts)) keySet.add(k);
  for (const k of extraIdentityKeys) keySet.add(normalizeIdentityKey(k));
  if (keySet.size === 0) return;
  const rows = [...keySet].map((identity_key) => ({
    identity_key,
    user_id: userId,
  }));
  const { error } = await supabase.from("calsync_identities").insert(rows);
  if (error) throw new Error(error.message);
}

/** Import `.data/store.json` into Supabase when DB has no users yet. */
export async function migrateLegacyFileStoreIfNeeded(): Promise<void> {
  if (migrationChecked) return;
  migrationChecked = true;

  const supabase = getSupabaseServiceClient();
  const { count, error: cErr } = await supabase
    .from("calsync_users")
    .select("*", { count: "exact", head: true });
  if (cErr) throw new Error(cErr.message);
  if ((count ?? 0) > 0) return;

  let raw: string;
  try {
    raw = fs.readFileSync(LEGACY_STORE_FILE, "utf8");
  } catch {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }

  const store = normalizeParsed(parsed);
  if (!isStoreConnected(store)) {
    try {
      fs.renameSync(LEGACY_STORE_FILE, `${LEGACY_STORE_FILE}.migrated-empty`);
    } catch {
      /* noop */
    }
    return;
  }

  const { data: userRow, error: uErr } = await supabase
    .from("calsync_users")
    .insert({})
    .select("id")
    .single();
  if (uErr || !userRow?.id) throw new Error(uErr?.message ?? "create user failed");

  const userId = userRow.id as string;

  await syncIdentitiesFromAccounts(userId, store.accounts, []);

  const { error: sErr } = await supabase.from("calsync_stores").insert({
    user_id: userId,
    store: store as unknown as Record<string, unknown>,
  });
  if (sErr) throw new Error(sErr.message);

  await syncWatchChannelIndex(userId, store.calendarWatchChannels);

  try {
    fs.renameSync(LEGACY_STORE_FILE, `${LEGACY_STORE_FILE}.migrated`);
  } catch {
    /* noop */
  }
}

export async function ensureMigrated(): Promise<void> {
  await migrateLegacyFileStoreIfNeeded();
}

export async function resolveUserIdByIdentityKey(
  key: string
): Promise<string | null> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calsync_identities")
    .select("user_id")
    .eq("identity_key", normalizeIdentityKey(key))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.user_id as string | undefined) ?? null;
}

export async function resolveUserIdByChannelId(
  channelId: string
): Promise<string | null> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calsync_watch_channels")
    .select("user_id")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.user_id as string | undefined) ?? null;
}

export async function createUser(): Promise<string> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calsync_users")
    .insert({})
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? "create user failed");
  return data.id as string;
}

export async function readStoreForUser(
  userId: string
): Promise<CalSyncStore | null> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calsync_stores")
    .select("store")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.store) return null;
  return normalizeParsed(data.store);
}

export async function listUserIds(): Promise<string[]> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("calsync_users").select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

export async function deleteUserAndData(userId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("calsync_users").delete().eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Persist store for a user. Empty accounts removes the user and all related rows (cascade).
 * `extraIdentityKeys` covers logins with no email (e.g. `google:<id>`) not stored on `ConnectedAccount`.
 */
export async function writeStoreForUser(
  userId: string,
  data: CalSyncStore,
  extraIdentityKeys: string[] = []
): Promise<void> {
  await ensureMigrated();
  const supabase = getSupabaseServiceClient();

  if (data.accounts.length === 0) {
    await deleteUserAndData(userId);
    return;
  }

  const normalized = normalizeParsed(data);

  const { error: upErr } = await supabase.from("calsync_stores").upsert(
    {
      user_id: userId,
      store: normalized as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (upErr) throw new Error(upErr.message);

  await syncIdentitiesFromAccounts(
    userId,
    normalized.accounts,
    extraIdentityKeys
  );
  await syncWatchChannelIndex(userId, normalized.calendarWatchChannels);
}
