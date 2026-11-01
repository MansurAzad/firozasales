import { fetchAccounting, dealerDues } from "./accounting";
import { toNumber } from "./money";

export function sumBy<T>(rows: T[], f: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + f(row), 0);
}

export interface AdminData {
  salesmen: { id: string; full_name: string; is_active: boolean }[];
  products: { id: string; name: string; model: string; price: number; category: string; is_active: boolean }[];
  imeiUnits: { id: string; product_id: string; imei: string; status: string; is_damaged: boolean; current_salesman: string | null }[];
  retailers: { id: string; name: string; is_active: boolean }[];
  sales: { id: string; salesman_id: string; retailer_id: string; total_amount: number; paid_amount: number; sold_at: string }[];
  payments: { id: string; salesman_id: string; retailer_id: string; amount: number; paid_at: string }[];
  deposits: { id: string; salesman_id: string; amount: number; deposited_at: string }[];
  stockIssues: { id: string; salesman_id: string }[];
  issueItems: { id: string; issue_id: string; product_id: string; quantity: number }[];
  saleItems: { id: string; sale_id: string; product_id: string; quantity: number }[];
  returns: { id: string; salesman_id: string; product_id: string; quantity: number }[];
}

/** Pieces issued to each salesman, across all stock issues. */
export function issuedBySalesman(d: AdminData): Map<string, number> {
  const salesmanOfIssue = new Map(d.stockIssues.map((i) => [i.id, i.salesman_id]));
  const map = new Map<string, number>();
  for (const item of d.issueItems) {
    const sid = salesmanOfIssue.get(item.issue_id);
    if (!sid) continue;
    map.set(sid, (map.get(sid) ?? 0) + item.quantity);
  }
  return map;
}

/** Everything the admin dashboards need, read once and aggregated client-side. */
export async function fetchAdminData(): Promise<AdminData> {
  const d = await fetchAccounting();
  const ids = new Set(d.roles.filter(r=>r.role==='salesman').map(r=>r.user_id));
  return { ...d, salesmen: d.profiles.filter(p=>ids.has(p.id)) };
}

export interface SalesmanData {
  products: { id: string; name: string; price: number; category: string }[];
  retailers: { id: string; name: string }[];
  sales: {
    id: string;
    retailer_id: string;
    total_amount: number;
    paid_amount: number;
    sold_at: string;
  }[];
  saleItems: {
    id: string;
    sale_id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
  }[];
  payments: { id: string; retailer_id: string; amount: number; paid_at: string; note: string }[];
  deposits: { id: string; settlement_id: string | null; amount: number; deposited_at: string; note: string }[];
  returns: {
    id: string;
    settlement_id: string | null;
    product_id: string;
    quantity: number;
    imei_unit_id: string | null;
    is_damaged: boolean;
    returned_at: string;
  }[];
  issues: { id: string; issued_at: string }[];
  issueItems: { id: string; issue_id: string; product_id: string; quantity: number; imei_unit_id: string | null }[];
  imeiUnits: { id: string; product_id: string; imei: string; status: string }[];
}

/** All signed-in data for one salesman, used by dashboard and settlement. */
export async function fetchSalesmanData(userId: string): Promise<SalesmanData> {
  const d = await fetchAccounting();
  const sales = d.sales.filter(s=>s.salesman_id===userId);
  const issues = d.stockIssues.filter(s=>s.salesman_id===userId);
  const saleIds = new Set(sales.map(s=>s.id));
  const issueIds = new Set(issues.map(s=>s.id));
  return { ...d, sales, issues, saleItems: d.saleItems.filter(i=>saleIds.has(i.sale_id)),
    issueItems: d.issueItems.filter(i=>issueIds.has(i.issue_id)),
    payments: d.payments.filter(p=>p.salesman_id===userId),
    deposits: d.deposits.filter(p=>p.salesman_id===userId),
    returns: d.returns.filter(p=>p.salesman_id===userId),
    imeiUnits: d.imeiUnits.filter(u=>u.current_salesman===userId) };
}

export interface SalesmanSummary {
  cashCollected: number;
  deposited: number;
  cashOnHand: number;
  dues: number;
}

export function summarizeSalesman(data: SalesmanData): SalesmanSummary {
  const cashCollected =
    sumBy(data.sales, (s) => toNumber(s.paid_amount)) +
    sumBy(data.payments, (p) => toNumber(p.amount));
  const deposited = sumBy(data.deposits, (d) => toNumber(d.amount));
  const dues = dealerDues(data.sales, data.payments);
  return {
    cashCollected,
    deposited,
    cashOnHand: cashCollected - deposited,
    dues,
  };
}

/** Per-product issued / sold / returned counts for one salesman. */
export function perProductStock(data: SalesmanData) {
  const map = new Map<string, { issued: number; sold: number; returned: number }>();
  for (const item of data.issueItems) {
    const row = map.get(item.product_id) ?? { issued: 0, sold: 0, returned: 0 };
    row.issued += item.quantity;
    map.set(item.product_id, row);
  }
  for (const item of data.saleItems) {
    const row = map.get(item.product_id) ?? { issued: 0, sold: 0, returned: 0 };
    row.sold += item.quantity;
    map.set(item.product_id, row);
  }
  for (const item of data.returns) {
    const row = map.get(item.product_id) ?? { issued: 0, sold: 0, returned: 0 };
    row.returned += item.quantity;
    map.set(item.product_id, row);
  }
  return map;
}
