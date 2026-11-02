import { openDB } from 'idb';
import type { AccountingSnapshot } from './accounting';
import type { MyRole } from './role';
import type { Json } from '@/integrations/supabase/types';

export type EntryKind = 'issue' | 'sale' | 'payment' | 'settlement' | 'catalog';
export interface LocalEntry { id: string; kind: EntryKind; payload: Json; createdAt: string; error?: string; confirmed?: boolean }
export interface LocalAccount { role: MyRole; snapshot?: AccountingSnapshot; updatedAt?: string; entries: LocalEntry[]; extras: Record<string, unknown>; revision?: number }
function db() { return openDB('fe-management-offline', 1, { upgrade(database) { database.createObjectStore('accounts'); } }); }
export async function readAccount(id: string): Promise<LocalAccount | undefined> { return (await db()).get('accounts', id); }
export async function writeAccount(id: string, update: (value: LocalAccount | undefined) => LocalAccount) {
  const database = await db();
  const tx = database.transaction('accounts', 'readwrite');
  const current = await tx.store.get(id) as LocalAccount | undefined;
  try {
    const next = update(current);
    if (next !== current) await tx.store.put({ ...next, revision: (current?.revision ?? 0) + 1 }, id);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed or aborted. */ }
    await tx.done.catch(() => {});
    throw error;
  }
  window.dispatchEvent(new Event('fe-local-change'));
}
export async function clearAccount(id: string) { await (await db()).delete('accounts', id); }
export function isOffline() { return typeof navigator !== 'undefined' && !navigator.onLine; }
export function onlineRequired() { if (isOffline()) throw new Error('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required'); }
export const firstUseMessage = 'প্রথমবার ইন্টারনেট দিয়ে লগইন করে হিসাব সংরক্ষণ করুন / Connect and sign in once to save your accounts';

/** Pure projection. Pending entries are provisional, never server-authorized records. */
export function projectEntries(base: AccountingSnapshot, entries: LocalEntry[], actor: MyRole): AccountingSnapshot {
  const d = structuredClone(base);
  for (const entry of entries) {
    const p = entry.payload as Record<string, Json | undefined>;
    const date = entry.createdAt, id = `local-${entry.id}`;
    const items = (Array.isArray(p['items']) ? p['items'] : []) as Record<string, Json | undefined>[];
    const sid = entry.kind === 'issue' ? String(p['salesman_id']) : actor.userId;
    if (entry.kind === 'catalog') {
      if (!actor.isAdmin || !actor.isActive) throw new Error('Admin required');
      const table = String(p['table']), action = String(p['action']), rows = (p['rows'] ?? []) as Record<string, Json>[];
      if (table !== 'products' && table !== 'retailers' && table !== 'imeiUnits') throw new Error('Invalid local table');
      if (!['insert','update','delete'].includes(action) || (table === 'imeiUnits' && action !== 'insert')) throw new Error('Invalid catalog action');
      if ((p['units'] as Json[] | undefined)?.length && (table !== 'products' || action !== 'insert')) throw new Error('Invalid attached IMEIs');
      const target = d[table] as unknown as Record<string, Json>[];
      for (const row of rows) {
        const index = target.findIndex(r => r['id'] === row['id']);
        if (action !== 'delete' && table === 'products' && 'price' in row && (!Number.isFinite(Number(row['price'])) || Number(row['price']) < 0)) throw new Error('Invalid price');
        if (action === 'insert' && index >= 0) throw new Error('Duplicate local ID');
        if (action === 'update' && index < 0) throw new Error('Record unavailable');
        if (table === 'imeiUnits' && d.imeiUnits.some(u => u.imei === row['imei'])) throw new Error('Duplicate IMEI');
        if (action === 'delete') {
          if (index < 0) throw new Error('Record unavailable');
          if (table === 'products' && (d.imeiUnits.some(u => u.product_id === row['id']) || d.issueItems.some(i => i.product_id === row['id']) || d.saleItems.some(i => i.product_id === row['id']) || d.returns.some(i => i.product_id === row['id']))) throw new Error('Stock or history exists; deactivate this product instead / স্টক বা ইতিহাস আছে; পণ্য বন্ধ করুন');
          if (table === 'retailers' && (d.sales.some(s => s.retailer_id === row['id']) || d.payments.some(s => s.retailer_id === row['id']))) throw new Error('Transaction history exists; deactivate this dealer instead / লেনদেন আছে; ডিলার বন্ধ করুন');
          target.splice(index, 1);
        }
        else if (index >= 0) Object.assign(target[index] ?? {}, row);
        else target.push({ created_at: date, is_active: true, model: '', price: 0, phone: '', address: '', status: 'in_dealer_stock', current_salesman: null, is_damaged: false, issued_at: null, sold_at: null, returned_at: null, ...row });
      }
      const units = (p['units'] ?? []) as Record<string, Json>[];
      for (const row of units) {
        if (d.imeiUnits.some(u => u.imei === row['imei'])) throw new Error('Duplicate IMEI');
        d.imeiUnits.push({ created_at: date, status: 'in_dealer_stock', current_salesman: null, is_damaged: false, issued_at: null, sold_at: null, returned_at: null, ...row } as unknown as AccountingSnapshot['imeiUnits'][number]);
      }
      continue;
    }
    if (!actor.isActive || (entry.kind === 'issue' ? !actor.isAdmin : actor.isAdmin)) throw new Error('No permission for offline entry');
    if (entry.kind === 'issue') d.stockIssues.push({ id, salesman_id: sid, issued_by: actor.userId, issued_at: date, note: '' });
    let total = 0;
    if (entry.kind === 'sale' || entry.kind === 'issue') {
      if (!items.length) throw new Error('No items');
      if (entry.kind === 'sale' && !d.retailers.some(r => r.id === p['retailer_id'] && r.is_active)) throw new Error('Dealer unavailable');
      if (entry.kind === 'issue' && !d.profiles.some(r => r.id === sid && r.is_active) ) throw new Error('SR unavailable');
      const seen = new Set<string>();
      for (const item of items) {
        const product = d.products.find(r => r.id === item['product_id'] && r.is_active);
        if (!product) throw new Error('Product unavailable');
        const units = (item['unit_ids'] ?? []) as string[];
        const quantity = product.category === 'smartphone' ? units.length : Number(item['quantity']);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid quantity');
        const price = Number(item['unit_price'] ?? 0);
        if (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) throw new Error('Invalid price');
        if (entry.kind === 'sale' && product.category === 'button_phone' && quantity > available(d, sid, product.id)) throw new Error('Insufficient saved stock');
        for (const unitId of units) {
          if (seen.has(unitId)) throw new Error('Duplicate IMEI'); seen.add(unitId);
          const unit = d.imeiUnits.find(u => u.id === unitId);
          if (!unit || unit.product_id !== product.id || unit.is_damaged || (entry.kind === 'issue' ? unit.status !== 'in_dealer_stock' : unit.status !== 'with_salesman' || unit.current_salesman !== sid)) throw new Error('IMEI unavailable');
          unit.status = entry.kind === 'issue' ? 'with_salesman' : 'sold'; unit.current_salesman = sid;
          if (entry.kind === 'issue') unit.issued_at = date; else unit.sold_at = date;
        }
        const lineUnits: (string | null)[] = units.length ? units : [null];
        for (const [n, unit] of lineUnits.entries()) {
          if (entry.kind === 'issue') d.issueItems.push({ id: `${id}-${product.id}-${n}`, issue_id: id, product_id: product.id, quantity: unit ? 1 : quantity, imei_unit_id: unit });
          else d.saleItems.push({ id: `${id}-${product.id}-${n}`, sale_id: id, product_id: product.id, quantity: unit ? 1 : quantity, imei_unit_id: unit, unit_price: price });
        }
        total += quantity * price;
      }
      if (entry.kind === 'sale') {
        const paid = Number(p['paid_amount']); checkCash(paid, total, true);
        d.sales.push({ id, retailer_id: String(p['retailer_id']), salesman_id: sid, total_amount: total, paid_amount: paid, sold_at: date, note: String(p['note'] ?? '') });
      }
    }
    if (entry.kind === 'payment') {
      const rid = String(p['retailer_id']);
      const due = d.sales.filter(s => s.salesman_id === sid && s.retailer_id === rid).reduce((n, s) => n + s.total_amount - s.paid_amount, 0) - d.payments.filter(s => s.salesman_id === sid && s.retailer_id === rid).reduce((n, s) => n + s.amount, 0);
      checkCash(Number(p['amount']), due);
      d.payments.push({ id, retailer_id: rid, salesman_id: sid, amount: Number(p['amount']), note: String(p['note'] ?? ''), paid_at: date });
    }
    if (entry.kind === 'settlement') {
      const returns = (p['returns'] ?? []) as Record<string, Json | undefined>[];
      const deposits = (p['deposits'] ?? []) as Record<string, Json | undefined>[];
      if (!returns.length && !deposits.length) throw new Error('Empty settlement');
      d.settlements.push({ id, salesman_id: sid, created_at: date, note: '' });
      for (const [n, row] of returns.entries()) {
        const product = d.products.find(r => r.id === row['product_id']);
        if (!product) throw new Error('Product unavailable');
        const units = (row['unit_ids'] ?? []) as string[];
        const quantity = product.category === 'smartphone' ? units.length : Number(row['quantity']);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > available(d, sid, product.id)) throw new Error('Invalid return quantity');
        for (const uid of units) {
          const unit = d.imeiUnits.find(u => u.id === uid && u.product_id === product.id && u.current_salesman === sid && u.status === 'with_salesman');
          if (!unit) throw new Error('IMEI unavailable');
          unit.status = 'in_dealer_stock'; unit.current_salesman = null; unit.is_damaged = row['is_damaged'] === true; unit.returned_at = date;
        }
        for (const [j, uid] of (units.length ? units : [null]).entries()) d.returns.push({ id: `${id}-r${n}-${j}`, settlement_id: id, salesman_id: sid, product_id: product.id, quantity: uid ? 1 : quantity, imei_unit_id: uid, is_damaged: row['is_damaged'] === true, returned_at: date });
      }
      let cash = cashOnHand(d, sid);
      for (const [n, row] of deposits.entries()) {
        const amount = Number(row['amount']); checkCash(amount, cash); cash -= amount;
        d.deposits.push({ id: `${id}-d${n}`, settlement_id: id, salesman_id: sid, amount, note: String(row['note'] ?? ''), deposited_at: date });
      }
    }
  }
  return d;
}
function available(d: AccountingSnapshot, sid: string, pid: string) {
  const issues = new Set(d.stockIssues.filter(i => i.salesman_id === sid).map(i => i.id));
  const sales = new Set(d.sales.filter(i => i.salesman_id === sid).map(i => i.id));
  return d.issueItems.filter(i => issues.has(i.issue_id) && i.product_id === pid).reduce((n, i) => n + i.quantity, 0) - d.saleItems.filter(i => sales.has(i.sale_id) && i.product_id === pid).reduce((n, i) => n + i.quantity, 0) - d.returns.filter(i => i.salesman_id === sid && i.product_id === pid).reduce((n, i) => n + i.quantity, 0);
}
function cashOnHand(d: AccountingSnapshot, sid: string) { return d.sales.filter(s => s.salesman_id === sid).reduce((n, s) => n + s.paid_amount, 0) + d.payments.filter(s => s.salesman_id === sid).reduce((n, s) => n + s.amount, 0) - d.deposits.filter(s => s.salesman_id === sid).reduce((n, s) => n + s.amount, 0); }
function checkCash(amount: number, max: number, zero = false) { if (!Number.isFinite(amount) || amount < (zero ? 0 : 0.01) || amount > max || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw new Error('Invalid cash amount'); }