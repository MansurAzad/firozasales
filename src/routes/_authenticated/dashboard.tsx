import { createFileRoute, Link } from "@tanstack/react-router";
import { dealerDues } from "@/lib/accounting";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { useMyRole } from "@/lib/role";
import { useLang } from "@/lib/i18n";
import { formatBDT, toNumber } from "@/lib/money";
import {
  fetchAdminData,
  fetchSalesmanData,
  issuedBySalesman,
  perProductStock,
  summarizeSalesman,
} from "@/lib/hisab";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "ড্যাশবোর্ড — FE MANAGEMENT" },
      { name: "description", content: "FIROZA ENTERPRISE dashboard: stock, sales, dues, deposits." },
      { property: "og:title", content: "ড্যাশবোর্ড — FE MANAGEMENT" },
      {
        property: "og:description",
        content: "Stock, sales, dues and deposits at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useLang();
  const role = useMyRole();

  if (role.isLoading || !role.data) {
    return (
      <AppShell title={t("nav_dashboard")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }

  return role.data.isAdmin ? (
    <AdminDashboard userId={role.data.userId} />
  ) : (
    <SalesmanDashboard userId={role.data.userId} />
  );
}

function AdminDashboard({ userId }: { userId: string }) {
  const { t } = useLang();
  const data = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => fetchAdminData(),
  });

  if (data.error) throw data.error;
  if (data.isLoading) {
    return (
      <AppShell title={t("nav_dashboard")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  const d = data.data;
  if (!d) return null;

  const dealerStock = d.imeiUnits.filter(u=>u.status === "in_dealer_stock" && !u.is_damaged).length;
  const totalSales=d.sales.reduce((a,s)=>a+toNumber(s.total_amount),0);
  const cash=d.sales.reduce((a,s)=>a+toNumber(s.paid_amount),0)+d.payments.reduce((a,p)=>a+toNumber(p.amount),0);
  const deposited=d.deposits.reduce((a,p)=>a+toNumber(p.amount),0);
  const returned=d.returns.reduce((a,r)=>a+r.quantity,0);
  const remaining=d.issueItems.reduce((a,i)=>a+i.quantity,0)-d.saleItems.reduce((a,i)=>a+i.quantity,0)-returned;

  return (
    <AppShell title={t("nav_dashboard")}>
      <h1 className="page-title mb-4">{t("nav_dashboard")}</h1>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[[t("total_sales"),formatBDT(totalSales)], [t("dash_cash_collected"),formatBDT(cash)],
          [t("dash_deposited"),formatBDT(deposited)], [t("dash_cash_on_hand"),formatBDT(cash-deposited)],
          [t("dash_dues"),formatBDT(dealerDues(d.sales,d.payments))], [t("sr_stock"),String(remaining)],
          [t("return_stock"),String(returned)], [t("damaged"),String(d.imeiUnits.filter(u=>u.is_damaged).length)]].map(([label,value])=>(
          <div className="stat-card" key={label}><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Link to="/stock-issue" className="btn-primary">{t("nav_stock_issue")}</Link>
        <Link to="/sales" className="btn-outline">{t("all_sales")}</Link>
        <Link to="/retailers" className="btn-outline">{t("ledger")}</Link>
        <Link to="/settlement" className="btn-outline">{t("nav_settlement")}</Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat-card">
          <div className="stat-value">{dealerStock}</div>
          <div className="stat-label">{t("dash_dealer_stock")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{d.products.length}</div>
          <div className="stat-label">{t("dash_total_products")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{d.salesmen.length}</div>
          <div className="stat-label">{t("nav_salesmen")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{d.retailers.length}</div>
          <div className="stat-label">{t("nav_retailers")}</div>
        </div>
      </div>

      <section className="card mb-5">
        <h2 className="card-title mb-3">{t("dash_per_salesman")}</h2>
        {d.salesmen.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head pb-2">{t("dash_salesman")}</th>
                  <th className="table-head pb-2">{t("dash_issued")}</th>
                  <th className="table-head pb-2">{t("dash_sales_total")}</th>
                  <th className="table-head pb-2">{t("dash_cash_collected")}</th>
                  <th className="table-head pb-2">{t("dash_deposited")}</th>
                  <th className="table-head pb-2">{t("dash_dues")}</th>
                </tr>
              </thead>
              <tbody>
                {d.salesmen.map((s) => {
                  const withStock = issuedBySalesman(d).get(s.id) ?? 0;
                  const sales = d.sales.filter((x) => x.salesman_id === s.id);
                  const payments = d.payments.filter((x) => x.salesman_id === s.id);
                  const deposits = d.deposits.filter((x) => x.salesman_id === s.id);
                  const salesTotal =
                    sales.reduce((a, x) => a + toNumber(x.total_amount), 0);
                  const cash =
                    sales.reduce((a, x) => a + toNumber(x.paid_amount), 0) +
                    payments.reduce((a, x) => a + toNumber(x.amount), 0);
                  const dep = deposits.reduce((a, x) => a + toNumber(x.amount), 0);
                  const dues = dealerDues(sales,payments);
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="table-cell font-medium">{s.full_name || "—"}</td>
                      <td className="table-cell">{withStock} {t("dash_pieces")}</td>
                      <td className="table-cell">{formatBDT(salesTotal)}</td>
                      <td className="table-cell">{formatBDT(cash)}</td>
                      <td className="table-cell">{formatBDT(dep)}</td>
                      <td className="table-cell font-semibold text-warning-foreground">
                        {formatBDT(dues)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title mb-3">{t("dash_per_retailer")}</h2>
        {d.retailers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head pb-2">{t("dash_retailer")}</th>
                  <th className="table-head pb-2">{t("total_sales")}</th>
                  <th className="table-head pb-2">{t("total_paid")}</th>
                  <th className="table-head pb-2">{t("dash_balance")}</th>
                </tr>
              </thead>
              <tbody>
                {d.retailers.map((r) => {
                  const sales = d.sales.filter((x) => x.retailer_id === r.id);
                  const salesTotal = sales.reduce((a, x) => a + toNumber(x.total_amount), 0);
                  const cash =
                    sales.reduce((a, x) => a + toNumber(x.paid_amount), 0) +
                    d.payments
                      .filter((p) => p.retailer_id === r.id)
                      .reduce((a, p) => a + toNumber(p.amount), 0);
                  const balance = Math.max(0, salesTotal - cash);
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="table-cell font-medium"><Link to="/retailers/$id" params={{id:r.id}} className="text-primary underline">{r.name}</Link></td>
                      <td className="table-cell">{formatBDT(salesTotal)}</td>
                      <td className="table-cell">{formatBDT(cash)}</td>
                      <td className="table-cell font-semibold text-warning-foreground">
                        {formatBDT(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("appName")} · {t("role_admin")}
      </p>
    </AppShell>
  );
}

function SalesmanDashboard({ userId }: { userId: string }) {
  const { t } = useLang();
  const data = useQuery({
    queryKey: ["salesman-dashboard", userId],
    queryFn: () => fetchSalesmanData(userId),
  });

  if (data.error) throw data.error;
  if (data.isLoading) {
    return (
      <AppShell title={t("nav_home")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  const d = data.data;
  if (!d) return null;

  const summary = summarizeSalesman(d);
  const stock = perProductStock(d);

  return (
    <AppShell title={t("dash_my_stock")}>
      <h1 className="page-title mb-4">{t("dash_my_stock")}</h1>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="stat-card">
          <div className="stat-value">{formatBDT(summary.cashCollected)}</div>
          <div className="stat-label">{t("dash_cash_collected")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBDT(summary.deposited)}</div>
          <div className="stat-label">{t("dash_deposited")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBDT(summary.cashOnHand)}</div>
          <div className="stat-label">{t("dash_cash_on_hand")}</div>
        </div>
      </div>

      <section className="card mb-5">
        <h2 className="card-title mb-3">{t("dash_my_stock")}</h2>
        {d.products.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head pb-2">{t("dash_product")}</th>
                  <th className="table-head pb-2">{t("dash_issued")}</th>
                  <th className="table-head pb-2">{t("dash_sold")}</th>
                  <th className="table-head pb-2">{t("dash_remaining")}</th>
                </tr>
              </thead>
              <tbody>
                {d.products
                  .filter((p) => stock.get(p.id))
                  .map((p) => {
                    const row = stock.get(p.id);
                    if (!row) return null;
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="table-cell font-medium">{p.name}</td>
                        <td className="table-cell">{row.issued}</td>
                        <td className="table-cell">{row.sold}</td>
                        <td className="table-cell font-semibold">
                          {Math.max(0, row.issued - row.sold - row.returned)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title mb-3">{t("dash_dues")}</h2>
        <p className="text-2xl font-bold text-warning-foreground">
          {formatBDT(summary.dues)}
        </p>
      </section>
    </AppShell>
  );
}
