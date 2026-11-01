import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { projectEntries, readAccount, writeAccount, type LocalEntry } from './offline-store';
import { refuseServiceWorker } from './pwa';
import type { AccountingSnapshot } from './accounting';
const actor = { userId: 'sr', isAdmin: false, isActive: true, fullName: 'SR' };
function base(): AccountingSnapshot {
  return { profiles: [{ id: 'sr', full_name: 'SR', is_active: true, created_at: '' }], roles: [], products: [{ id: 'p', name: 'Nokia', category: 'button_phone', model: '', price: 1000, is_active: true, created_at: '' }], imeiUnits: [], retailers: [{ id: 'r', name: 'Dealer', phone: '', address: '', is_active: true, created_at: '' }], sales: [{ id: 'sale', retailer_id: 'r', salesman_id: 'sr', paid_amount: 20000, total_amount: 31000, note: '', sold_at: '' }], saleItems: [], payments: [], deposits: [{ id: 'd', amount: 15000, salesman_id: 'sr', settlement_id: null, deposited_at: '', note: '' }], returns: [], stockIssues: [{ id: 'i', salesman_id: 'sr', issued_by: 'admin', issued_at: '', note: '' }], issueItems: [{ id: 'ii', issue_id: 'i', product_id: 'p', quantity: 5, imei_unit_id: null }], settlements: [] };
}
function entry(kind: LocalEntry['kind'], payload: LocalEntry['payload']): LocalEntry { return { kind, payload, id: 'request', createdAt: '2026-11-01T12:00:00Z' }; }
describe('offline rules', () => {
  it('keeps saved accounts separate by authenticated user', async () => {
    await writeAccount('a', () => ({ role: { ...actor, userId: 'a' }, entries: [], extras: {}, snapshot: base() }));
    expect(await readAccount('b')).toBeUndefined(); expect((await readAccount('a'))?.role.userId).toBe('a');
  });
  it('persists entries across database reads', async () => {
    await writeAccount('persist', () => ({ role: actor, entries: [entry('payment', { retailer_id: 'r', amount: 3000 })], extras: {} }));
    expect((await readAccount('persist'))?.entries[0]?.payload).toEqual({ retailer_id: 'r', amount: 3000 });
  });
  it('projects 3000 collection and 8000 deposit in order without changing saved base', () => {
    const d = base(), projected = projectEntries(d, [entry('payment', { retailer_id: 'r', amount: 3000 }), { ...entry('settlement', { returns: [], deposits: [{ amount: 8000 }] }), id: 'second' }], actor);
    expect(projected.payments[0]?.amount).toBe(3000); expect(projected.deposits[1]?.amount).toBe(8000); expect(d.payments).toHaveLength(0);
  });
  it('rejects collection beyond the saved 11000 due', () => expect(() => projectEntries(base(), [entry('payment', { retailer_id: 'r', amount: 11000.01 })], actor)).toThrow());
  it('rejects deposit beyond saved 5000 cash', () => expect(() => projectEntries(base(), [entry('settlement', { returns: [], deposits: [{ amount: 5000.01 }] })], actor)).toThrow());
  it('rejects selling more than five saved button phones', () => expect(() => projectEntries(base(), [entry('sale', { retailer_id: 'r', paid_amount: 0, items: [{ product_id: 'p', quantity: 6, unit_price: 1000, unit_ids: [] }] })], actor)).toThrow());
  it('projects quantity returns without an IMEI', () => expect(projectEntries(base(), [entry('settlement', { returns: [{ product_id: 'p', quantity: 2, unit_ids: [] }], deposits: [] })], actor).returns[0]?.quantity).toBe(2));
  it('rejects inactive local financial entries', () => expect(() => projectEntries(base(), [entry('payment', { retailer_id: 'r', amount: 1 })], { ...actor, isActive: false })).toThrow());
  it('blocks preview, iframe, development and kill-switch workers while allowing published domains', () => {
    expect(refuseServiceWorker('id-preview--abc.lovable.app', true, false, false)).toBe(true);
    expect(refuseServiceWorker('preview-2--abc.gpt-eng.com', true, false, false)).toBe(true);
    expect(refuseServiceWorker('project--abc-dev.lovable.app', true, false, false)).toBe(true);
    expect(refuseServiceWorker('firozasales.lovable.app', true, true, false)).toBe(true);
    expect(refuseServiceWorker('firozasales.lovable.app', false, false, false)).toBe(true);
    expect(refuseServiceWorker('firozasales.lovable.app', true, false, true)).toBe(true);
    expect(refuseServiceWorker('firozasales.lovable.app', true, false, false)).toBe(false);
    expect(refuseServiceWorker('preview-v2--shop.example.com', true, false, false)).toBe(false);
  });
});