import { Button } from "@/components/ui/button";
import { usePosting, validCash, fetchAccounting } from "@/lib/accounting";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { formatBDT, toNumber } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/retailers/$id")({
  head: () => ({
    meta: [
      { title: "লেজার — FE MANAGEMENT" },
      { name: "description", content: "Retailer ledger: stock, payments, balance." },
      { property: "og:title", content: "লেজার — FE MANAGEMENT" },
      { property: "og:description", content: "Retailer ledger: stock, payments, balance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RetailerLedgerPage,
});

function RetailerLedgerPage() {
  const { id } = Route.useParams();
  const { t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["retailer-ledger", id, role.data?.userId],
    queryFn: async () => {
      const d = await fetchAccounting();
      const uid=role.data?.userId;
      const isAdmin=role.data?.isAdmin;
      return { retailer:d.retailers.find(r=>r.id===id), profiles:d.profiles,
        sales:d.sales.filter(s=>s.retailer_id===id && (isAdmin || s.salesman_id===uid)),
        payments:d.payments.filter(s=>s.retailer_id===id && (isAdmin || s.salesman_id===uid)) };

    },
    enabled: !!role.data?.userId,
  });

  const post = usePosting();
  if (data.error) throw data.error;
  const d = data.data;

  const totalSales = (d?.sales ?? []).reduce((a, s) => a + toNumber(s.total_amount), 0);
  const totalPaidAtSale = (d?.sales ?? []).reduce((a, s) => a + toNumber(s.paid_amount), 0);
  const totalPayments = (d?.payments ?? []).reduce((a, p) => a + toNumber(p.amount), 0);
  const balance = Math.max(0, totalSales - totalPaidAtSale - totalPayments);

  const addPayment = useMutation({
    mutationFn: async (input: { amount: number; note: string }) => {
      if (!validCash(input.amount,balance)) throw new Error(t('invalid_cash'));
      return post('payment', { retailer_id:id, amount:input.amount, note:input.note });
    },
    onSuccess: () => {
      toast.success(t("payment_recorded"));
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (data.isLoading || !role.data?.userId) {
    return (
      <AppShell title={t("ledger")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  if (!d || !d.retailer) {
    return (
      <AppShell title={t("ledger")}>
        <p className="text-sm text-muted-foreground">{t("noData")}</p>
      </AppShell>
    );
  }

  type Entry =
    | { at: string; kind: "sale"; total: number; paid: number; salesman: string }
    | { at: string; kind: "payment"; amount: number; note: string; salesman: string };
  const entries: Entry[] = [
    ...d.sales.map((s) => ({
      at: s.sold_at,
      kind: "sale" as const,
      total: toNumber(s.total_amount),
      paid: toNumber(s.paid_amount),
      salesman: d.profiles.find((p) => p.id === s.salesman_id)?.full_name ?? "—",
    })),
    ...d.payments.map((p) => ({
      at: p.paid_at,
      kind: "payment" as const,
      amount: toNumber(p.amount),
      note: p.note,
      salesman: d.profiles.find((pp) => pp.id === p.salesman_id)?.full_name ?? "—",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <AppShell title={`${t("ledger")} · ${d.retailer.name}`}>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/retailers" className="btn-ghost btn-sm">
          ← {t("retailers_title")}
        </Link>
      </div>

      <h1 className="page-title mb-1">{d.retailer.name}</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        {d.retailer.phone || "—"} {d.retailer.address ? `· ${d.retailer.address}` : ""}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <div className="stat-value">{formatBDT(totalSales)}</div>
          <div className="stat-label">{t("total_sales")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBDT(totalPaidAtSale + totalPayments)}</div>
          <div className="stat-label">{t("total_paid")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-warning-foreground">{formatBDT(balance)}</div>
          <div className="stat-label">{t("balance")}</div>
        </div>
      </div>

      {!role.data.isAdmin ? (
        <><PaymentCollect
          balance={balance}
          busy={addPayment.isPending}
          onSubmit={(amount, note) => addPayment.mutate({ amount, note })}
        /><Button asChild variant="outline" className="mb-4 w-full min-h-11 whitespace-normal"><Link to="/settlement">{t("deposit_entry")}</Link></Button></>
      ) : null}

      <section className="card">
        <h2 className="card-title mb-3">{t("ledger")}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          entries.map((e, idx) => (
            <div key={idx} className="row">
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {e.kind === "sale"
                    ? `${t("total_sales")}: ${formatBDT(e.total)}`
                    : `${t("payments")}: ${formatBDT(e.amount)}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()} · {e.salesman}
                  {e.kind === "payment" && e.note ? ` · ${e.note}` : ""}
                </div>
              </div>
              {e.kind === "sale" ? (
                <span className="badge-mut max-w-32 whitespace-normal">
                  {t("paid")}: {formatBDT(e.paid)}
                </span>
              ) : (
                <span className="badge-ok max-w-32 whitespace-normal">{formatBDT(e.amount)}</span>
              )}
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}

function PaymentCollect({
  balance,
  busy,
  onSubmit,
}: {
  balance: number;
  busy: boolean;
  onSubmit: (amount: number, note: string) => void;
}) {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="card mb-4">
      <h2 className="card-title mb-2">{t("receive_payment")}</h2>
      <form
        className="grid min-w-0 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!validCash(n,balance)) { toast.error(t("invalid_cash")); return; }
          onSubmit(n, note);
          setAmount("");
          setNote("");
        }}
      >
        <div><label className="label" htmlFor="payment-amount">{t("payment_amount")}</label><input
          id="payment-amount"
          inputMode="decimal"
          type="number"
          min="0.01"
          step="0.01"
          max={balance}
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={formatBDT(balance)}
          required
        /></div>
        <div><label className="label" htmlFor="payment-note">{t("note")}</label><input
          id="payment-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("note")}
        /></div>
        <Button type="submit" className="btn-primary sm:col-span-2" disabled={busy || balance<=0}>
          {t("receive_payment")}
        </Button>
      </form>
    </div>
  );
}
