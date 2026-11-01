import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), getUser: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession, getUser: mocks.getUser } } }));
import { enqueue, localAccess, saveRole, syncOffline, offlineSnapshot } from './offline';
import { clearAccount, readAccount, writeAccount } from './offline-store';
import type { AccountingSnapshot } from './accounting';
const role = { userId: 'sync-user', isAdmin: false, isActive: true, fullName: 'SR' };
const snapshot: AccountingSnapshot = { profiles: [{ id: role.userId, full_name: 'SR', is_active: true, created_at: '' }], roles: [], products: [], imeiUnits: [], retailers: [], sales: [{ id: 'sale', retailer_id: 'r', salesman_id: role.userId, total_amount: 100, paid_amount: 0, note: '', sold_at: '' }], saleItems: [], payments: [], deposits: [], returns: [], stockIssues: [], issueItems: [], settlements: [] };
beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: role.userId } } } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: role.userId } }, error: null });
  await clearAccount(role.userId); await saveRole(role);
});
describe('offline access and synchronization', () => {
  it('rejects first offline access without an initial saved snapshot', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await localAccess()).toBeNull();
  });
  it('allows saved offline views without a live authentication request', async () => {
    await writeAccount(role.userId, c => ({ role, entries: [], extras: {}, ...c, snapshot }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect((await localAccess())?.userId).toBe(role.userId); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('keeps the same request key on retry and only clears after snapshot read-back', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'stable-id');
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'Connection lost' } });
    await expect(syncOffline()).rejects.toThrow('Connection lost');
    expect((await readAccount(role.userId))?.entries[0]?.id).toBe('stable-id');
    const confirmed = { ...snapshot, payments: [{ id: 'confirmed', retailer_id: 'r', salesman_id: role.userId, amount: 25, paid_at: '', note: '' }] };
    mocks.rpc.mockImplementation(async name => name === 'accounting_snapshot' ? { data: confirmed, error: null } : { data: 'confirmed', error: null });
    await syncOffline();
    expect(mocks.rpc).toHaveBeenCalledWith('post_transaction', { p_kind: 'payment', p_payload: { retailer_id: 'r', amount: 25 }, p_request_id: 'stable-id' });
    expect((await readAccount(role.userId))?.entries).toHaveLength(0); expect((await readAccount(role.userId))?.snapshot?.payments[0]?.amount).toBe(25);
  });
  it('halts at a rejected posting and retains it and later entries', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'one'); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'two');
    mocks.rpc.mockResolvedValue({ error: { message: 'Dealer balance changed' } });
    await expect(syncOffline()).rejects.toThrow('Dealer balance changed');
    expect((await readAccount(role.userId))?.entries).toHaveLength(2); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects a different payload reusing a saved request id', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'same-id');
    await expect(enqueue('payment', { retailer_id: 'r', amount: 30 }, 'same-id')).rejects.toThrow('Request ID already used');
    expect((await readAccount(role.userId))?.entries[0]?.payload).toEqual({ retailer_id: 'r', amount: 25 });
  });
  it('does not overwrite a newly synchronized snapshot with a slow earlier refresh', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    let resolveRead: (value: { data: AccountingSnapshot; error: null }) => void = () => { throw new Error('Read not started'); };
    let started: () => void = () => {};
    const readStarted = new Promise<void>(resolve => { started = resolve; });
    mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; started(); }));
    const refresh = offlineSnapshot(); await readStarted;
    const fresh = { ...snapshot, payments: [{ id: 'fresh-payment', retailer_id: 'r', salesman_id: role.userId, amount: 25, paid_at: '', note: '' }] };
    await writeAccount(role.userId, c => ({ role, entries: [], extras: {}, ...c, snapshot: fresh, updatedAt: 'newer', revision: 1 }));
    resolveRead({ data: snapshot, error: null }); await refresh;
    expect((await readAccount(role.userId))?.snapshot?.payments[0]?.amount).toBe(25);
  });
  it('does not repost an acknowledged transaction when snapshot read-back failed', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'acknowledged');
    mocks.rpc.mockImplementation(async name => name === 'accounting_snapshot' ? { error: { message: 'Read unavailable' } } : { data: 'posted', error: null });
    await expect(syncOffline()).rejects.toThrow('Read unavailable');
    expect((await readAccount(role.userId))?.entries[0]?.confirmed).toBe(true);
    const confirmed = { ...snapshot, payments: [{ id: 'posted', retailer_id: 'r', salesman_id: role.userId, amount: 25, paid_at: '', note: '' }] };
    mocks.rpc.mockResolvedValue({ data: confirmed, error: null }); await syncOffline();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'post_transaction')).toHaveLength(1);
    expect((await readAccount(role.userId))?.entries).toHaveLength(0);
    expect((await readAccount(role.userId))?.snapshot?.payments[0]?.amount).toBe(25);
  });
  it('uses atomic catalog posting with the original request id on retry', async () => {
    const admin = { ...role, isAdmin: true };
    await writeAccount(role.userId, () => ({ role: admin, entries: [], extras: {}, snapshot }));
    const payload = { table: 'products', action: 'insert', rows: [{ id: 'p', name: 'Phone', category: 'button_phone', price: 1200 }], units: [] };
    await enqueue('catalog', payload, 'catalog-key');
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'Lost response' } });
    await expect(syncOffline()).rejects.toThrow('Lost response');
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null }); await syncOffline();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'post_catalog')).toEqual([['post_catalog', { p_request_id: 'catalog-key', p_payload: payload }], ['post_catalog', { p_request_id: 'catalog-key', p_payload: payload }]]);
  });
  it('never posts when the verified user differs from the queued account', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot })); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'identity');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
    await expect(syncOffline()).rejects.toThrow('Reconnect and sign in'); expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await readAccount(role.userId))?.entries).toHaveLength(1);
  });
  it('shares one synchronization runner for concurrent callers', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot })); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'concurrent');
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null }); await Promise.all([syncOffline(), syncOffline(), syncOffline()]);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'post_transaction')).toHaveLength(1);
  });
  it('retains new entries queued while an earlier entry is being synchronized', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot })); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'first');
    let inserted = false;
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === 'post_transaction' && args.p_request_id === 'first' && !inserted) { inserted = true; await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'second'); }
      if (name === 'post_transaction' && args.p_request_id === 'second') return { error: { message: 'Second rejected' } };
      return { data: snapshot, error: null };
    });
    await expect(syncOffline()).rejects.toThrow('Second rejected');
    expect((await readAccount(role.userId))?.entries.map(e => e.id)).toEqual(['second']);
  });
  it('stops sending later entries if the connection drops during synchronization', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot }));
    await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'first'); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'second');
    mocks.rpc.mockImplementation(async name => {
      if (name === 'post_transaction') { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); return { data: 'posted', error: null }; }
      return { error: { message: 'Disconnected' } };
    });
    await expect(syncOffline()).rejects.toThrow('Disconnected');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'post_transaction')).toHaveLength(1);
    expect((await readAccount(role.userId))?.entries).toHaveLength(2);
  });
  it('keeps acknowledged entries if the account changes before snapshot replacement', async () => {
    await writeAccount(role.userId, () => ({ role, entries: [], extras: {}, snapshot })); await enqueue('payment', { retailer_id: 'r', amount: 25 }, 'switch');
    mocks.rpc.mockImplementation(async name => {
      if (name === 'accounting_snapshot') mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'another-account' } } } });
      return { data: snapshot, error: null };
    });
    await syncOffline(); expect((await readAccount(role.userId))?.entries[0]?.confirmed).toBe(true);
    expect((await readAccount(role.userId))?.snapshot?.payments).toHaveLength(0);
  });
});