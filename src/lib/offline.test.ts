import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), getUser: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession, getUser: mocks.getUser } } }));
import { enqueue, localAccess, saveRole, syncOffline } from './offline';
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
});