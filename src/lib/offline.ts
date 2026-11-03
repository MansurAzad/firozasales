import { supabase } from "@/integrations/supabase/client";
import type { AccountingSnapshot } from "./accounting";
import type { MyRole } from "./role";
import type { Json } from "@/integrations/supabase/types";
import {
  firstUseMessage,
  isOffline,
  projectEntries,
  readAccount,
  writeAccount,
  type LocalEntry,
  type LocalAccount,
} from "./offline-store";

const identityKey = "fe-offline-account";
export async function sessionId() {
  // Local identity is a device-view selector only; server authorization never trusts it.
  if (isOffline()) return localStorage.getItem(identityKey) ?? undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id;
}
export function forgetLocalIdentity() {
  localStorage.removeItem(identityKey);
}
export async function localAccess() {
  const id = await sessionId();
  const account = id ? await readAccount(id) : undefined;
  return account?.role.isActive && account.snapshot ? account.role : null;
}
export async function saveRole(role: MyRole) {
  await writeAccount(role.userId, (current) => ({ entries: [], extras: {}, ...current, role }));
  localStorage.setItem(identityKey, role.userId);
}
export async function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const id = await sessionId();
  if (!id) throw new Error(firstUseMessage);
  const account = await readAccount(id);
  if (!isOffline() && !account?.entries.length) {
    const value = await fetcher();
    if (account)
      await writeAccount(id, (current) => ({
        ...(current ?? account),
        extras: { ...(current?.extras ?? {}), [key]: value },
      }));
    return value;
  }
  const value = account?.extras[key];
  if (value === undefined) throw new Error(firstUseMessage);
  return value as T;
}
async function serverSnapshot(): Promise<AccountingSnapshot> {
  const { data, error } = await supabase.rpc("accounting_snapshot");
  if (error) throw new Error(error.message);
  const keys = [
    "profiles",
    "roles",
    "products",
    "imeiUnits",
    "retailers",
    "sales",
    "saleItems",
    "payments",
    "deposits",
    "returns",
    "stockIssues",
    "issueItems",
    "settlements",
    "inventoryReceipts",
    "inventoryReceiptItems",
    "dealerReturns",
    "dealerReturnItems",
    "transactionReversals",
  ];
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    keys.some((k) => !Array.isArray(data[k]))
  )
    throw new Error("Could not read complete accounts");
  return data as unknown as AccountingSnapshot;
}
export async function offlineSnapshot(): Promise<AccountingSnapshot> {
  const id = await sessionId();
  if (!id) throw new Error(firstUseMessage);
  let account = await readAccount(id);
  if (!isOffline() && !account?.entries.length) {
    const snapshot = await serverSnapshot();
    if ((await sessionId()) !== id) throw new Error("Account changed");
    const profile = snapshot.profiles.find((p) => p.id === id);
    const role: MyRole = {
      userId: id,
      isAdmin: snapshot.roles.some((r) => r.user_id === id && r.role === "admin"),
      fullName: profile?.full_name ?? "",
      isActive: profile?.is_active === true,
    };
    await writeAccount(id, (current) =>
      current && (current.entries.length || (current.revision ?? 0) !== (account?.revision ?? 0))
        ? current
        : {
            entries: [],
            extras: {},
            ...current,
            snapshot,
            role,
            updatedAt: new Date().toISOString(),
          },
    );
    localStorage.setItem(identityKey, id);
    account = await readAccount(id);
  }
  if (!account?.snapshot || !account.role.isActive) throw new Error(firstUseMessage);
  return projectEntries(account.snapshot, account.entries, account.role);
}
export async function findImei(code: string) {
  return { data: (await offlineSnapshot()).imeiUnits.find((u) => u.imei === code) ?? null };
}
export async function enqueue(kind: LocalEntry["kind"], payload: Json, id: string) {
  const uid = await sessionId();
  if (!uid) throw new Error(firstUseMessage);
  await writeAccount(uid, (current) => {
    if (!current?.snapshot || !current.role.isActive) throw new Error(firstUseMessage);
    const existing = current.entries.find((e) => e.id === id);
    if (existing) {
      if (existing.kind !== kind || JSON.stringify(existing.payload) !== JSON.stringify(payload))
        throw new Error("Request ID already used with different input");
      return current;
    }
    if (kind === "catalog" && !current.role.isAdmin) throw new Error("Admin required");
    const entry: LocalEntry = { id, kind, payload, createdAt: new Date().toISOString() };
    projectEntries(current.snapshot, [...current.entries, entry], current.role);
    return { ...current, entries: [...current.entries, entry] };
  });
}
export async function postOfflineAware(
  kind: "issue" | "sale" | "payment" | "settlement" | "inventory_receipt" | "dealer_return",
  payload: Json,
  id: string,
) {
  const uid = await sessionId(),
    account = uid ? await readAccount(uid) : undefined;
  if (kind === "dealer_return") {
    if (isOffline()) throw new Error("Dealer returns require an internet connection");
    if (account?.entries.length)
      throw new Error("Synchronize pending entries before posting a dealer return");
    const { data, error } = await supabase.rpc("post_dealer_return", {
      p_payload: payload,
      p_request_id: id,
    });
    if (error) throw new Error(error.message);
    return data;
  }
  if (isOffline() || account?.entries.length) {
    await enqueue(kind, payload, id);
    return { pending: true, id: `local-${id}` };
  }
  const { data, error } =
    kind === "inventory_receipt"
      ? await supabase.rpc("post_inventory_receipt", { p_payload: payload, p_request_id: id })
      : await supabase.rpc("post_transaction", {
          p_kind: kind,
          p_payload: payload,
          p_request_id: id,
        });
  if (error) throw new Error(error.message);
  return data;
}
export type CatalogTable = "products" | "retailers";
export async function catalogWrite(
  table: CatalogTable,
  action: "insert" | "update" | "delete",
  rows: Record<string, Json>[],
  units: Record<string, Json>[] = [],
) {
  const prepared = rows.map((row) => ({ ...row, id: row["id"] ?? crypto.randomUUID() }));
  const payload = { table, action, rows: prepared, units };
  await enqueue("catalog", payload, crypto.randomUUID());
  if (!isOffline()) {
    try {
      await syncOffline();
    } catch {
      /* Remains visibly queued; never lose an accepted local entry. */
    }
  }
  return prepared;
}
async function sendCatalog(entry: LocalEntry) {
  const { error } = await supabase.rpc("post_catalog", {
    p_request_id: entry.id,
    p_payload: entry.payload,
  });
  if (error) throw new Error(error.message);
}
async function sendInventoryReceipt(entry: LocalEntry) {
  const { error } = await supabase.rpc("post_inventory_receipt", {
    p_request_id: entry.id,
    p_payload: entry.payload,
  });
  if (error) throw new Error(error.message);
}

let syncing: Promise<void> | undefined;
export function syncOffline() {
  if (syncing) return syncing;
  syncing = (async () => {
    if (navigator.locks) await navigator.locks.request("fe-outbox-sync", () => runSync());
    else await runSync();
  })().finally(() => {
    syncing = undefined;
  });
  return syncing;
}
async function runSync() {
  if (isOffline()) return;
  const uid = await sessionId();
  if (!uid) return;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || user?.id !== uid) throw new Error("Reconnect and sign in to synchronize");
  // Every server write still revalidates current role, activation, stock and balances.
  for (;;) {
    if (isOffline()) throw new Error("Connection lost; entries remain saved locally");
    const account = await readAccount(uid),
      entry = account?.entries.find((candidate) => !candidate.supersededBy);
    if (!entry) break;
    if ((await sessionId()) !== uid) return;
    try {
      if (!entry.confirmed) {
        if (entry.kind === "catalog") await sendCatalog(entry);
        else if (entry.kind === "inventory_receipt") await sendInventoryReceipt(entry);
        else {
          const result = await supabase.rpc("post_transaction", {
            p_kind: entry.kind,
            p_payload: entry.payload,
            p_request_id: entry.id,
          });
          if (result.error) throw new Error(result.error.message);
        }
        await writeAccount(uid, (current) => {
          if (!current) throw new Error("Local account missing");
          return {
            ...current,
            entries: current.entries.map((e) => {
              if (!sameEntry(e, entry)) return e;
              const acknowledged = { ...e, confirmed: true };
              delete acknowledged.error;
              return acknowledged;
            }),
          };
        });
      }
      // Atomic local replacement prevents double projection after an ambiguous network response.
      const snapshot = await serverSnapshot();
      if ((await sessionId()) !== uid) return;
      await writeAccount(uid, (current) => {
        if (!current) throw new Error("Local account missing");
        if (!current.entries.some((e) => sameEntry(e, entry))) return current;
        const profile = snapshot.profiles.find((p) => p.id === uid);
        const role: MyRole = {
          userId: uid,
          isAdmin: snapshot.roles.some((r) => r.user_id === uid && r.role === "admin"),
          fullName: profile?.full_name ?? "",
          isActive: profile?.is_active === true,
        };
        return {
          ...current,
          snapshot,
          role,
          updatedAt: new Date().toISOString(),
          entries: current.entries.filter((e) => !sameEntry(e, entry)),
        };
      });
    } catch (error) {
      await writeAccount(uid, (current) => {
        if (!current) throw new Error("Local account missing");
        return {
          ...current,
          entries: current.entries.map((e) =>
            sameEntry(e, entry)
              ? { ...e, error: error instanceof Error ? error.message : "Sync failed" }
              : e,
          ),
        };
      });
      throw error;
    }
  }
  await offlineSnapshot();
}
export async function resolveBlockedProductDelete(entryId: string) {
  if (isOffline()) throw new Error("Connect to the internet to resolve this entry");
  const uid = await sessionId();
  if (!uid) throw new Error("Sign in to resolve this entry");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || user?.id !== uid) throw new Error("Reconnect and sign in to resolve this entry");

  const account = await readAccount(uid);
  if (!account?.snapshot || !account.role.isAdmin || !account.role.isActive)
    throw new Error("Admin access required");
  const baseSnapshot = account.snapshot;
  const entry = account.entries.find((candidate) => candidate.id === entryId);
  if (
    !entry ||
    entry.kind !== "catalog" ||
    entry.supersededBy ||
    !entry.error?.includes("Stock or history exists; deactivate this product instead")
  )
    throw new Error("This entry is not a blocked product deletion");

  const payload = entry.payload as Record<string, Json | undefined>;
  const rows = payload["rows"];
  const productId =
    payload["table"] === "products" &&
    payload["action"] === "delete" &&
    Array.isArray(rows) &&
    rows.length === 1 &&
    typeof rows[0] === "object" &&
    rows[0] !== null &&
    "id" in rows[0] &&
    typeof rows[0]["id"] === "string"
      ? rows[0]["id"]
      : undefined;
  if (!productId) throw new Error("The blocked entry is not a single product deletion");

  const snapshot = await serverSnapshot();
  if (
    !snapshot.profiles.some((profile) => profile.id === uid && profile.is_active) ||
    !snapshot.roles.some((role) => role.user_id === uid && role.role === "admin")
  )
    throw new Error("Active Admin access is required");
  if (!snapshot.products.some((product) => product.id === productId))
    throw new Error("Product no longer exists on the server");

  const replacementId = crypto.randomUUID();
  const replacement: LocalEntry = {
    id: replacementId,
    kind: "catalog",
    payload: {
      table: "products",
      action: "update",
      rows: [{ id: productId, is_active: false }],
      units: [],
    },
    createdAt: new Date().toISOString(),
  };
  await writeAccount(uid, (current) => {
    if (!current) throw new Error("Local account missing");
    const pending = current.entries.find((candidate) => candidate.id === entryId);
    if (
      !pending ||
      pending.supersededBy ||
      pending.kind !== entry.kind ||
      JSON.stringify(pending.payload) !== JSON.stringify(entry.payload)
    )
      throw new Error("The pending entry changed; refresh and try again");
    const nextEntries = current.entries.flatMap((candidate) =>
      candidate.id === entryId
        ? [{ ...candidate, supersededBy: replacementId }, replacement]
        : [candidate],
    );
    projectEntries(current.snapshot ?? baseSnapshot, nextEntries, current.role);
    return { ...current, entries: nextEntries };
  });
  return replacementId;
}
function sameEntry(a: LocalEntry, b: LocalEntry) {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload)
  );
}
export async function currentLocalAccount(): Promise<LocalAccount | undefined> {
  const uid = await sessionId();
  return uid ? readAccount(uid) : undefined;
}
