import { Button } from "@/components/ui/button";
import { usePosting, validCash, fetchAccounting } from "@/lib/accounting";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { formatBDT, toNumber } from "@/lib/money";
import { displayBusinessDate } from "@/lib/business-time";
import { reference } from "@/lib/reports";

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
  const { lang, t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["retailer-ledger", id, role.data?.userId],
    queryFn: async () => {
      const d = await fetchAccounting();
      const uid = role.data?.userId;
      const isAdmin = role.data?.isAdmin;
      const sales = d.sales.filter(
        (s) => s.retailer_id === id && (isAdmin || s.salesman_id === uid),
      );
      const saleIds = new Set(sales.map((s) => s.id));
      const dealerReturns = d.dealerReturns.filter(
        (r) => r.retailer_id === id && (isAdmin || r.salesman_id === uid),
      );
      const dealerReturnIds = new Set(dealerReturns.map((r) => r.id));
      return {
        retailer: d.retailers.find((r) => r.id === id),
        profiles: d.profiles,
        products: d.products,
        imeiUnits: d.imeiUnits,
        sales,
        saleItems: d.saleItems.filter((i) => saleIds.has(i.sale_id)),
        payments: d.payments.filter(
          (s) => s.retailer_id === id && (isAdmin || s.salesman_id === uid),
        ),
        dealerReturns,
        dealerReturnItems: d.dealerReturnItems.filter((item) =>
          dealerReturnIds.has(item.dealer_return_id),
        ),
      };
    },
    enabled: !!role.data?.userId,
  });

  const post = usePosting();
  if (data.error) throw data.error;
  const d = data.data;

  const totalSales = (d?.sales ?? []).reduce((a, s) => a + toNumber(s.total_amount), 0);
  const totalPaidAtSale = (d?.sales ?? []).reduce((a, s) => a + toNumber(s.paid_amount), 0);
  const totalPayments = (d?.payments ?? []).reduce((a, p) => a + toNumber(p.amount), 0);
  const totalCredits = (d?.dealerReturns ?? []).reduce(
    (total, row) => total + toNumber(row.credit_amount),
    0,
  );
  const balance = totalSales - totalPaidAtSale - totalPayments - totalCredits;

  const addPayment = useMutation({
    mutationFn: async (input: { amount: number; note: string }) => {
      if (!validCash(input.amount, balance)) throw new Error(t("invalid_cash"));
      return post("payment", { retailer_id: id, amount: input.amount, note: input.note });
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
    | { at: string; kind: "payment"; amount: number; note: string; salesman: string }
    | {
        at: string;
        kind: "credit_note";
        amount: number;
        refund: number;
        credit: number;
        note: string;
        salesman: string;
      };
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
    ...d.dealerReturns.map((r) => ({
      at: r.created_at,
      kind: "credit_note" as const,
      amount: r.total_amount,
      refund: r.refund_amount,
      credit: r.credit_amount,
      note: r.note,
      salesman: d.profiles.find((profile) => profile.id === r.salesman_id)?.full_name ?? "—",
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

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat-card">
          <div className="stat-value">{formatBDT(totalSales)}</div>
          <div className="stat-label">{t("total_sales")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBDT(totalPaidAtSale + totalPayments)}</div>
          <div className="stat-label">{t("total_paid")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-warning-foreground">
            {formatBDT(Math.max(0, balance))}
          </div>
          <div className="stat-label">{t("balance")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBDT(Math.max(0, -balance))}</div>
          <div className="stat-label">{lang === "bn" ? "ডিলার ক্রেডিট" : "Dealer credit"}</div>
        </div>
      </div>

      {!role.data.isAdmin ? (
        <>
          <PaymentCollect
            balance={balance}
            busy={addPayment.isPending}
            onSubmit={(amount, note) => addPayment.mutate({ amount, note })}
          />
          <Button asChild variant="outline" className="mb-4 w-full min-h-11 whitespace-normal">
            <Link to="/settlement">{t("deposit_entry")}</Link>
          </Button>
        </>
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
                    : e.kind === "payment"
                      ? `${t("payments")}: ${formatBDT(e.amount)}`
                      : `${lang === "bn" ? "ক্রেডিট নোট" : "Credit note"}: ${formatBDT(e.amount)}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {displayBusinessDate(e.at)} · {e.salesman}
                  {e.kind === "payment" && e.note ? ` · ${e.note}` : ""}
                  {e.kind === "credit_note"
                    ? ` · ${lang === "bn" ? "নগদ ফেরত" : "Refund"} ${formatBDT(e.refund)} · ${lang === "bn" ? "বাকি ক্রেডিট" : "Due credit"} ${formatBDT(e.credit)}${e.note ? ` · ${e.note}` : ""}`
                    : ""}
                </div>
              </div>
              {e.kind === "sale" ? (
                <span className="badge-mut max-w-32 whitespace-normal">
                  {t("paid")}: {formatBDT(e.paid)}
                </span>
              ) : e.kind === "payment" ? (
                <span className="badge-ok max-w-32 whitespace-normal">{formatBDT(e.amount)}</span>
              ) : (
                <span className="badge-warn max-w-32 whitespace-normal">{formatBDT(e.credit)}</span>
              )}
            </div>
          ))
        )}
      </section>
      {role.data.isAdmin && (
        <DealerReturnEditor
          sales={d.sales}
          saleItems={d.saleItems}
          products={d.products}
          imeiUnits={d.imeiUnits}
          returns={d.dealerReturns}
          returnItems={d.dealerReturnItems}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["retailer-ledger", id] })}
        />
      )}
    </AppShell>
  );
}

interface DealerReturnEditorProps {
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
    imei_unit_id: string | null;
  }[];
  products: { id: string; name: string }[];
  imeiUnits: { id: string; imei: string }[];
  returns: { id: string; sale_id: string; refund_amount: number }[];
  returnItems: { id: string; dealer_return_id: string; sale_item_id: string; quantity: number }[];
  onDone: () => void;
}

function DealerReturnEditor({
  sales,
  saleItems,
  products,
  imeiUnits,
  returns,
  returnItems,
  onDone,
}: DealerReturnEditorProps) {
  const { lang, t } = useLang();
  const post = usePosting();
  const [saleId, setSaleId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { quantity: string; is_damaged: boolean }>>(
    {},
  );
  const [refund, setRefund] = useState("0");
  const [note, setNote] = useState("");
  const sale = sales.find((row) => row.id === saleId);
  const lines = saleItems.filter((item) => item.sale_id === saleId);
  const returnedByItem = new Map<string, number>();
  for (const item of returnItems) {
    returnedByItem.set(
      item.sale_item_id,
      (returnedByItem.get(item.sale_item_id) ?? 0) + item.quantity,
    );
  }
  const selected = lines.flatMap((item) => {
    const quantity = Number(drafts[item.id]?.quantity ?? 0);
    return quantity > 0
      ? [{ ...item, quantity, is_damaged: drafts[item.id]?.is_damaged ?? false }]
      : [];
  });
  const invalidQuantity = selected.some((item) => {
    const remaining = item.quantity - (returnedByItem.get(item.id) ?? 0);
    return !Number.isInteger(item.quantity) || item.quantity > remaining;
  });
  const total = selected.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const alreadyRefunded = returns
    .filter((row) => row.sale_id === saleId)
    .reduce((sum, row) => sum + row.refund_amount, 0);
  const maxRefund = Math.min(total, Math.max(0, (sale?.paid_amount ?? 0) - alreadyRefunded));

  const submit = useMutation({
    mutationFn: async () => {
      if (!sale || selected.length === 0) throw new Error(t("noData"));
      if (invalidQuantity)
        throw new Error(
          lang === "bn"
            ? "ফেরত পরিমাণ পূর্ণ সংখ্যা ও অবশিষ্ট পরিমাণের মধ্যে হতে হবে"
            : "Return quantities must be whole numbers within the remaining invoice quantity",
        );
      if (!validCash(Number(refund), maxRefund, true)) throw new Error(t("invalid_cash"));
      return post("dealer_return", {
        sale_id: sale.id,
        refund_amount: Number(refund),
        note: note.trim(),
        items: selected.map((item) => ({
          sale_item_id: item.id,
          quantity: item.quantity,
          is_damaged: item.is_damaged,
        })),
      });
    },
    onSuccess: () => {
      toast.success(lang === "bn" ? "ক্রেডিট নোট সংরক্ষিত হয়েছে" : "Credit note saved");
      setDrafts({});
      setRefund("0");
      setNote("");
      setSaleId("");
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="card mb-4">
      <h2 className="card-title mb-3">
        {lang === "bn" ? "চালানভিত্তিক ডিলার রিটার্ন" : "Invoice-linked dealer return"}
      </h2>
      <label className="mb-3 block">
        <span className="label">{lang === "bn" ? "মূল চালান" : "Original invoice"}</span>
        <select
          className="input"
          value={saleId}
          onChange={(event) => {
            setSaleId(event.target.value);
            setDrafts({});
            setRefund("0");
          }}
        >
          <option value="">—</option>
          {sales.map((row) => (
            <option key={row.id} value={row.id}>
              {reference("INV", row.id)} · {displayBusinessDate(row.sold_at)}
            </option>
          ))}
        </select>
      </label>
      {sale && (
        <>
          <div className="space-y-2">
            {lines.map((item) => {
              const returned = returnedByItem.get(item.id) ?? 0;
              const remaining = item.quantity - returned;
              const draft = drafts[item.id] ?? { quantity: "0", is_damaged: false };
              const product = products.find((row) => row.id === item.product_id);
              const imei = item.imei_unit_id
                ? imeiUnits.find((unit) => unit.id === item.imei_unit_id)?.imei
                : null;
              return (
                <div key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{product?.name ?? item.product_id}</p>
                      {imei && <p className="text-xs text-muted-foreground">IMEI: {imei}</p>}
                      <p className="text-xs text-muted-foreground">
                        {lang === "bn" ? "ফেরতযোগ্য" : "Returnable"}: {remaining} ·{" "}
                        {formatBDT(item.unit_price)} {lang === "bn" ? "প্রতি পিস" : "each"}
                      </p>
                    </div>
                    <input
                      aria-label={`${lang === "bn" ? "ফেরত পরিমাণ" : "Return quantity"}: ${product?.name ?? item.product_id}`}
                      className="input w-24"
                      type="number"
                      min="0"
                      max={remaining}
                      step="1"
                      value={draft.quantity}
                      disabled={remaining <= 0}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, quantity: event.target.value },
                        }))
                      }
                    />
                  </div>
                  {remaining > 0 && Number(draft.quantity) > 0 && (
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.is_damaged}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.id]: { ...draft, is_damaged: event.target.checked },
                          }))
                        }
                      />
                      {lang === "bn" ? "নষ্ট পণ্য" : "Damaged item"}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">
                {lang === "bn" ? "নগদ ফেরত" : "Cash refund"} (max {formatBDT(maxRefund)})
              </span>
              <input
                className="input"
                type="number"
                min="0"
                max={maxRefund}
                step="0.01"
                value={refund}
                onChange={(event) => setRefund(event.target.value)}
              />
            </label>
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p>
                {lang === "bn" ? "ফেরত মূল্য" : "Return value"}: {formatBDT(total)}
              </p>
              <p>
                {lang === "bn" ? "ডিলার ব্যালেন্স ক্রেডিট" : "Dealer balance credit"}:{" "}
                {formatBDT(Math.max(0, total - (Number(refund) || 0)))}
              </p>
            </div>
          </div>
          <label className="mt-3 block">
            <span className="label">
              {t("note")} ({t("optional")})
            </span>
            <input
              className="input"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            {lang === "bn"
              ? "নগদ ফেরত মূল চালানে পরিশোধিত নগদের মধ্যে সীমিত; অন্য আদায় চালানভিত্তিক বরাদ্দ নয়।"
              : "Cash refunds are limited to cash paid on this invoice; later aggregate payments are not allocated to invoices."}
          </p>
          <Button
            className="mt-3 w-full"
            disabled={
              submit.isPending ||
              !sale ||
              selected.length === 0 ||
              invalidQuantity ||
              !validCash(Number(refund), maxRefund, true)
            }
            onClick={() => submit.mutate()}
          >
            {submit.isPending
              ? t("loading")
              : lang === "bn"
                ? "ক্রেডিট নোট নিশ্চিত করুন"
                : "Post credit note"}
          </Button>
        </>
      )}
    </section>
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
          if (!validCash(n, balance)) {
            toast.error(t("invalid_cash"));
            return;
          }
          onSubmit(n, note);
          setAmount("");
          setNote("");
        }}
      >
        <div>
          <label className="label" htmlFor="payment-amount">
            {t("payment_amount")}
          </label>
          <input
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
          />
        </div>
        <div>
          <label className="label" htmlFor="payment-note">
            {t("note")}
          </label>
          <input
            id="payment-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("note")}
          />
        </div>
        <Button type="submit" className="btn-primary sm:col-span-2" disabled={busy || balance <= 0}>
          {t("receive_payment")}
        </Button>
      </form>
    </div>
  );
}
