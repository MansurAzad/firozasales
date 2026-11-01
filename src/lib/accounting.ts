import type { Database, Json } from '@/integrations/supabase/types';
import { useRef } from 'react';
import { offlineSnapshot, postOfflineAware } from './offline';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export interface AccountingSnapshot {
  profiles: Row<'profiles'>[]; roles: Row<'user_roles'>[]; products: Row<'products'>[];
  imeiUnits: Row<'imei_units'>[]; retailers: Row<'retailers'>[]; sales: Row<'sales'>[];
  saleItems: Row<'sale_items'>[]; payments: Row<'retailer_payments'>[]; deposits: Row<'deposits'>[];
  returns: Row<'returns'>[]; stockIssues: Row<'stock_issues'>[]; issueItems: Row<'stock_issue_items'>[];
  settlements: Row<'settlements'>[];
}
export async function fetchAccounting(): Promise<AccountingSnapshot> {
  return offlineSnapshot();
}
/** Preserve an idempotency key after a lost response; changed input starts a new posting. */
export function usePosting() {
  const pending = useRef<{ signature: string; id: string } | null>(null);
  return async (kind: 'issue'|'sale'|'payment'|'settlement', payload: Json) => {
    const signature = JSON.stringify([kind, payload]);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    const request = pending.current;
    if (!request) throw new Error('Could not start transaction');
    const data = await postOfflineAware(kind, payload, request.id);
    pending.current = null;
    return data;
  };
}
export function dealerDues(sales: { retailer_id: string; total_amount: number; paid_amount: number }[], payments: { retailer_id: string; amount: number }[]) {
  const balances = new Map<string, number>();
  for (const s of sales) balances.set(s.retailer_id,(balances.get(s.retailer_id) ?? 0)+Number(s.total_amount)-Number(s.paid_amount));
  for (const p of payments) balances.set(p.retailer_id,(balances.get(p.retailer_id) ?? 0)-Number(p.amount));
  return [...balances.values()].reduce((sum,n)=>sum+Math.max(0,n),0);
}
export function validCash(amount: number, maximum: number, allowZero = false) {
  return Number.isFinite(amount) && amount >= (allowZero ? 0 : 0.01) && amount <= maximum && Math.abs(amount*100-Math.round(amount*100))<0.000001;
}
