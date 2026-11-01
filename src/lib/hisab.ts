import { supabase } from "@/integrations/supabase/client";
import { toNumber } from "./money";

export function sumBy<T>(rows: T[], f: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + f(row), 0);
}

export interface SalesmanData {
  products: { id: string; name: string; price: string; category: string }[];
  retailers: { id: string; name: string }[];
  sales: {
    id: string;
    retailer_id: string;
    total_amount: string;
    paid_amount: string;
    sold_at: string;
  }[];
  saleItems: {
    id: string;
    sale_id: string;
    product_id: string;
    quantity: number;
    unit_price: string;
  }[];
  payments: { id: string; retailer_id: string; amount: string; paid_at: string; note: string }[];
  deposits: { id: string; settlement_id: string | null; amount: string; deposited_at: string; note: string }[];
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
  const [productsRes, retailersRes, salesRes, paymentsRes, depositsRes, returnsRes] =
    await Promise.all([
      supabase.from("products").select("id, name, price, category").order("name"),
      supabase.from("retailers").select("id, name").order("name"),
      supabase
        .from("sales")
        .select("id, retailer_id, total_amount, paid_amount, sold_at")
        .eq("salesman_id", userId)
        .order("sold_at", { ascending: false }),
      supabase
        .from("retailer_payments")
        .select("id, retailer_id, amount, paid_at, note")
        .eq("salesman_id", userId)
        .order("paid_at", { ascending: false }),
      supabase
        .from("deposits")
        .select("id, settlement_id, amount, deposited_at, note")
        .eq("salesman_id", userId)
        .order("deposited_at", { ascending: false }),
      supabase
        .from("returns")
        .select(
          "id, settlement_id, product_id, quantity, imei_unit_id, is_damaged, returned_at",
        )
        .eq("salesman_id", userId),
    ]);

  const issueIds = (issuesRes.data ?? []).map((r) => r.id);
  const saleIds = (salesRes.data ?? []).map((r) => r.id);

  const [issuesRes2, issueItemsRes, saleItemsRes, imeiRes] = await Promise.all([
    supabase
      .from("stock_issues")
      .select("id, issued_at")
      .eq("salesman_id", userId)
      .order("issued_at", { ascending: false }),
    issueIds.length
      ? supabase
          .from("stock_issue_items")
          .select("id, issue_id, product_id, quantity, imei_unit_id")
          .in("issue_id", issueIds)
      : Promise.resolve({ data: [] as never[] }),
    saleIds.length
      ? supabase
          .from("sale_items")
          .select("id, sale_id, product_id, quantity, unit_price")
          .in("sale_id", saleIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("imei_units")
      .select("id, product_id, imei, status")
      .eq("current_salesman", userId),
  ]);

  return {
    products: productsRes.data ?? [],
    retailers: retailersRes.data ?? [],
    sales: salesRes.data ?? [],
    saleItems: saleItemsRes.data ?? [],
    payments: paymentsRes.data ?? [],
    deposits: depositsRes.data ?? [],
    returns: returnsRes.data ?? [],
    issues: issuesRes2.data ?? [],
    issueItems: issueItemsRes.data ?? [],
    imeiUnits: imeiRes.data ?? [],
  };
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
  const charged = sumBy(data.sales, (s) => toNumber(s.total_amount));
  const dues = Math.max(0, charged - cashCollected);
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
