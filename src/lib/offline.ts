import { supabase } from '@/integrations/supabase/client';
import type { AccountingSnapshot } from './accounting';
import type { MyRole } from './role';
import type { Json } from '@/integrations/supabase/types';
import { firstUseMessage, isOffline, projectEntries, readAccount, writeAccount, type LocalEntry, type LocalAccount } from './offline-store';

const identityKey = 'fe-offline-account';
export async function sessionId() {
  // Local identity is a device-view selector only; server authorization never trusts it.
  if (isOffline()) return localStorage.getItem(identityKey) ?? undefined;
  const { data } = await supabase.auth.getSession(); return data.session?.user.id;
}
export function forgetLocalIdentity() { localStorage.removeItem(identityKey); }
export async function localAccess() {
  const id = await sessionId();
  const account = id ? await readAccount(id) : undefined;
  return account?.role.isActive && account.snapshot ? account.role : null;
}
export async function saveRole(role: MyRole) {
  await writeAccount(role.userId, current => ({ entries: [], extras: {}, ...current, role }));
  localStorage.setItem(identityKey, role.userId);
}
export async function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const id = await sessionId(); if (!id) throw new Error(firstUseMessage);
  const account = await readAccount(id);
  if (!isOffline() && !account?.entries.length) {
    const value = await fetcher();
    if (account) await writeAccount(id, current => ({ ...current ?? account, extras: { ...(current?.extras ?? {}), [key]: value } }));
    return value;
  }
  const value = account?.extras[key]; if (value === undefined) throw new Error(firstUseMessage); return value as T;
}
async function serverSnapshot(): Promise<AccountingSnapshot> {
  const { data, error } = await supabase.rpc('accounting_snapshot');
  if (error) throw new Error(error.message);
  const keys = ['profiles','roles','products','imeiUnits','retailers','sales','saleItems','payments','deposits','returns','stockIssues','issueItems','settlements'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || keys.some(k => !Array.isArray(data[k]))) throw new Error('Could not read complete accounts');
  return data as unknown as AccountingSnapshot;
}
export async function offlineSnapshot(): Promise<AccountingSnapshot> {
  const id = await sessionId(); if (!id) throw new Error(firstUseMessage);
  let account = await readAccount(id);
  if (!isOffline() && !account?.entries.length) {
    const snapshot = await serverSnapshot();
    if (await sessionId() !== id) throw new Error('Account changed');
    const profile = snapshot.profiles.find(p => p.id === id);
    const role: MyRole = { userId: id, isAdmin: snapshot.roles.some(r => r.user_id === id && r.role === 'admin'), fullName: profile?.full_name ?? '', isActive: profile?.is_active === true };
    await writeAccount(id, current => current?.entries.length ? current : ({ entries: [], extras: {}, ...current, snapshot, role, updatedAt: new Date().toISOString() }));
    localStorage.setItem(identityKey, id);
    account = await readAccount(id);
  }
  if (!account?.snapshot || !account.role.isActive) throw new Error(firstUseMessage);
  return projectEntries(account.snapshot, account.entries, account.role);
}
export async function findImei(code: string) { return { data: (await offlineSnapshot()).imeiUnits.find(u => u.imei === code) ?? null }; }
export async function enqueue(kind: LocalEntry['kind'], payload: Json, id: string) {
  const uid = await sessionId(); if (!uid) throw new Error(firstUseMessage);
  await writeAccount(uid, current => {
    if (!current?.snapshot || !current.role.isActive) throw new Error(firstUseMessage);
    if (current.entries.some(e => e.id === id)) return current;
    if (kind === 'catalog' && !current.role.isAdmin) throw new Error('Admin required');
    const entry: LocalEntry = { id, kind, payload, createdAt: new Date().toISOString() };
    projectEntries(current.snapshot, [...current.entries, entry], current.role);
    return { ...current, entries: [...current.entries, entry] };
  });
}
export async function postOfflineAware(kind: 'issue'|'sale'|'payment'|'settlement', payload: Json, id: string) {
  const uid = await sessionId(), account = uid ? await readAccount(uid) : undefined;
  if (isOffline() || account?.entries.length) {
    await enqueue(kind, payload, id);
    return { pending: true, id: `local-${id}` };
  }
  const { data, error } = await supabase.rpc('post_transaction', { p_kind: kind, p_payload: payload, p_request_id: id });
  if (error) throw new Error(error.message); return data;
}
export type CatalogTable = 'products'|'retailers'|'imeiUnits';
export async function catalogWrite(table: CatalogTable, action: 'insert'|'update'|'delete', rows: Record<string, Json>[], units: Record<string, Json>[] = []) {
  const prepared = rows.map(row => ({ ...row, id: row['id'] ?? crypto.randomUUID() }));
  const payload = { table, action, rows: prepared, units };
  await enqueue('catalog', payload, crypto.randomUUID());
  if (!isOffline()) { try { await syncOffline(); } catch { /* Remains visibly queued; never lose an accepted local entry. */ } }
  return prepared;
}
async function sendCatalog(entry: LocalEntry) {
  const { error } = await supabase.rpc('post_catalog', { p_request_id: entry.id, p_payload: entry.payload });
  if (error) throw new Error(error.message);
}

let syncing: Promise<void> | undefined;
export function syncOffline() {
  if (syncing) return syncing;
  syncing = (navigator.locks ? navigator.locks.request('fe-outbox-sync', () => runSync()) : runSync()).finally(() => { syncing = undefined; }); return syncing;
}
async function runSync() {
  if (isOffline()) return;
  const uid = await sessionId(); if (!uid) return;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || user?.id !== uid) throw new Error('Reconnect and sign in to synchronize');
  // Every server write still revalidates current role, activation, stock and balances.
  for (;;) {
    const account = await readAccount(uid), entry = account?.entries[0];
    if (!entry) break;
    if (await sessionId() !== uid) return;
    try {
      if (entry.kind === 'catalog') await sendCatalog(entry);
      else {
        const result = await supabase.rpc('post_transaction', { p_kind: entry.kind, p_payload: entry.payload, p_request_id: entry.id });
        if (result.error) throw new Error(result.error.message);
      }
      // Atomic local replacement prevents double projection after an ambiguous network response.
      const snapshot = await serverSnapshot();
      if (await sessionId() !== uid) return;
      await writeAccount(uid, current => {
        if (!current) throw new Error('Local account missing');
        return { ...current, snapshot, updatedAt: new Date().toISOString(), entries: current.entries.filter(e => e.id !== entry.id) };
      });
    } catch (error) {
      await writeAccount(uid, current => {
        if (!current) throw new Error('Local account missing');
        return { ...current, entries: current.entries.map(e => e.id === entry.id ? { ...e, error: error instanceof Error ? error.message : 'Sync failed' } : e) };
      });
      throw error;
    }
  }
  await offlineSnapshot();
}
export async function currentLocalAccount(): Promise<LocalAccount | undefined> { const uid = await sessionId(); return uid ? readAccount(uid) : undefined; }