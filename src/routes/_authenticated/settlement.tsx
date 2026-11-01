import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ImeiScanner } from "@/components/ImeiScanner";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { formatBDT, toNumber } from "@/lib/money";
import {
  fetchAdminData,
  fetchSalesmanData,
  perProductStock,
  summarizeSalesman,
} from "@/lib/hisab";

export const Route = createFileRoute("/_authenticated/settlement")({
  head: () => ({
    meta: [
      { title: "সেটেলমেন্ট — মোবাইল হিসাব" },
      { name: "description", content: "Return stock, deposit cash, settle the trip." },
      { property: "og:title", content: "সেটেলমেন্ট — মোবাইল হিসাব" },
      { property: "og:description", content: "Return stock, deposit cash, settle the trip." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettlementPage,
});

function SettlementPage() {
  const { t } = useLang();
  const role = useMyRole();

  if (role.isLoading || !role.data) {
    return (
      <AppShell title={t("settlement_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  return role.data.isAdmin ? (
    <AdminSettlement />
  ) : (
    <SalesmanSettlement userId={role.data.userId} />
  );
}

interface ReturnDraft {
  product_id: string;
  name: string;
  qty: number;
  damaged: boolean;
  units: { id: string; imei: string }[];
}

function SalesmanSettlement({ userId }: { userId: string }) {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const [returns, setReturns] = useState<ReturnDraft[]>([]);
  const [deposits, setDeposits] = useState<{ amount: number; note: string }[]>([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [scanProductId, setScanProductId] = useState("");

  const data = useQuery({
    queryKey: ["settlement-page", userId],
    queryFn: () => fetchSalesmanData(userId),
  });

  const history = useQuery({
    queryKey: ["settlement-history", userId],
    queryFn: async () => {
      const [settlementsRes, depositsRes, returnsRes] = await Promise.all([
        supabase
          .from("settlements")
          .select("id, created_at")
          .eq("salesman_id", userId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("deposits")
          .select("id, settlement_id, amount")
          .eq("salesman_id", userId),
        supabase
          .from("returns")
          .select("id, settlement_id, quantity")
          .eq("salesman_id", userId),
      ]);
      return {
        settlements: settlementsRes.data ?? [],
        deposits: depositsRes.data ?? [],
        returns: returnsRes.data ?? [],
      };
    },
  });

  const d = data.data;
  if (data.isLoading || !d) {
    return (
      <AppShell title={t("settlement_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }

  const summary = summarizeSalesman(d);
  const stock = perProductStock(d);
  const pendingProducts = d.products
    .map((p) => {
      const row = stock.get(p.id);
      const remaining = row ? row.issued - row.sold - row.returned : 0;
      return { ...p, remaining };
    })
    .filter((p) => p.remaining > 0);

  const scanProduct = pendingProducts.find((p) => p.id === scanProductId);

  const checkReturnImei = async (code: string) => {
    const { data: unit } = await supabase
      .from("imei_units")
      .select("id, product_id, status, current_salesman")
      .eq("imei", code)
      .maybeSingle();
    if (!unit || unit.status !== "with_salesman" || unit.current_salesman !== userId) {
      return { ok: false, message: t("imei_return_err") };
    }
    if (scanProduct && unit.product_id !== scanProduct.id) {
      return { ok: false, message: t("imei_return_err") };
    }
    if (returns.some((r) => r.units.some((u) => u.id === unit.id))) {
      return { ok: false, message: t("imei_duplicate") };
    }
    return { ok: true, message: t("imei_return_ok") };
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (returns.length === 0 && deposits.length === 0) throw new Error(t("noData"));
      const { data: settlement, error } = await supabase
        .from("settlements")
        .insert({ salesman_id: userId })
        .select("id")
        .single();
      if (error) throw error;

      for (const r of returns) {
        if (r.units.length > 0) {
          for (const unit of r.units) {
            const { data: returnRow, error: e } = await supabase
              .from("returns")
              .insert({
                settlement_id: settlement.id,
                salesman_id: userId,
                product_id: r.product_id,
                quantity: 1,
                imei_unit_id: unit.id,
                is_damaged: r.damaged,
              })
              .select("id")
              .single();
            if (e) throw e;
            const { error: rpcError } = await supabase.rpc("return_imei", {
              p_imei: unit.imei,
              p_return_id: returnRow.id,
            });
            if (rpcError) throw rpcError;
          }
        } else if (r.qty > 0) {
          const { error: e } = await supabase.from("returns").insert({
            settlement_id: settlement.id,
            salesman_id: userId,
            product_id: r.product_id,
            quantity: r.qty,
            is_damaged: r.damaged,
          });
          if (e) throw e;
        }
      }

      for (const dep of deposits) {
        const { error: e } = await supabase.from("deposits").insert({
          settlement_id: settlement.id,
          salesman_id: userId,
          amount: dep.amount,
          note: dep.note,
        });
        if (e) throw e;
      }
      return settlement.id;
    },
    onSuccess: () => {
      toast.success(t("settlement_saved"));
      setReturns([]);
      setDeposits([]);
      setDepositAmount("");
      setDepositNote("");
      queryClient.invalidateQueries({ queryKey: ["settlement-page", userId] });
      queryClient.invalidateQueries({ queryKey: ["settlement-history", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const h = history.data;

  return (
    <AppShell title={t("settlement_title")}>
      <h1 className="page-title mb-4">{t("settlement_title")}</h1>

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
          <div className="stat-value text-warning-foreground">{formatBDT(summary.cashOnHand)}</div>
          <div className="stat-label">{t("expected_cash")}</div>
        </div>
      </div>

      <section className="card mb-4">
        <h2 className="card-title mb-3">{t("returns_entry")}</h2>

        <div className="field">
          <label className="label" htmlFor="st-product">{t("add_item")}</label>
          <select
            id="st-product"
            className="input"
            value={scanProductId}
            onChange={(e) => setScanProductId(e.target.value)}
          >
            <option value="">—</option>
            {pendingProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.remaining})
              </option>
            ))}
          </select>
        </div>

        {scanProduct ? (
          scanProduct.category === "smartphone" ? (
            <ImeiScanner
              hint={t("scan_imei_own")}
              check={checkReturnImei}
              onAccepted={(code) =>
                supabase
                  .from("imei_units")
                  .select("id")
                  .eq("imei", code)
                  .maybeSingle()
                  .then(({ data: unit }) => {
                    if (!unit) return;
                    setReturns((prev) => {
                      const existing = prev.find((r) => r.product_id === scanProduct.id);
                      if (existing) {
                        return prev.map((r) =>
                          r.product_id === scanProduct.id
                            ? { ...r, units: [...r.units, { id: unit.id, imei: code }] }
                            : r,
                        );
                      }
                      return [
                        ...prev,
                        {
                          product_id: scanProduct.id,
                          name: scanProduct.name,
                          qty: 0,
                          damaged: false,
                          units: [{ id: unit.id, imei: code }],
                        },
                      ];
                    });
                  })
            />
          ) : (
            <AddQtyReturn
              productName={scanProduct.name}
              maxQty={scanProduct.remaining}
              onAdd={(qty, damaged) => {
                setReturns((prev) => [
                  ...prev,
                  { product_id: scanProduct.id, name: scanProduct.name, qty, damaged, units: [] },
                ]);
                setScanProductId("");
              }}
            />
          )
        ) : null}

        {returns.map((r, idx) => (
          <div key={idx} className="mb-2 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.units.length > 0
                    ? `${r.units.length} ${t("qty")}`
                    : `${r.qty} ${t("qty")}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={r.damaged}
                    onChange={(e) =>
                      setReturns((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, damaged: e.target.checked } : x)),
                      )
                    }
                  />
                  {t("damaged")}
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-destructive"
                  onClick={() => setReturns((prev) => prev.filter((_, i) => i !== idx))}
                >
                  {t("delete")}
                </button>
              </div>
            </div>
            {r.units.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.units.map((u) => (
                  <span key={u.id} className="badge-mut">{u.imei}</span>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <h2 className="card-title mb-2 mt-4">{t("deposit_entry")}</h2>
        <form
          className="mb-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(depositAmount);
            if (!n || n <= 0) return;
            setDeposits((prev) => [...prev, { amount: n, note: depositNote }]);
            setDepositAmount("");
            setDepositNote("");
          }}
        >
          <input
            type="number"
            min="1"
            className="input max-w-[160px]"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder={formatBDT(Math.max(0, summary.cashOnHand))}
            required
          />
          <input
            className="input max-w-[180px]"
            value={depositNote}
            onChange={(e) => setDepositNote(e.target.value)}
            placeholder={t("note")}
          />
          <button type="submit" className="btn-secondary btn-sm">
            {t("add")}
          </button>
        </form>
        {deposits.map((dep, idx) => (
          <div key={idx} className="row">
            <span className="font-semibold">{formatBDT(dep.amount)}</span>
            <button
              type="button"
              className="btn-ghost btn-sm text-destructive"
              onClick={() => setDeposits((prev) => prev.filter((_, i) => i !== idx))}
            >
              {t("delete")}
            </button>
          </div>
        ))}

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={(returns.length === 0 && deposits.length === 0) || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {t("settle_btn")}
        </button>
      </section>

      <section className="card">
        <h2 className="card-title mb-3">{t("history")}</h2>
        {!h || h.settlements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          h.settlements.map((s) => {
            const dep = h.deposits
              .filter((x) => x.settlement_id === s.id)
              .reduce((a, x) => a + toNumber(x.amount), 0);
            const ret = h.returns
              .filter((x) => x.settlement_id === s.id)
              .reduce((a, x) => a + x.quantity, 0);
            return (
              <div key={s.id} className="row">
                <div>
                  <div className="font-medium text-foreground">
                    {t("returns_entry")}: {ret} · {t("deposit_entry")}: {formatBDT(dep)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>
    </AppShell>
  );
}

function AddQtyReturn({
  productName,
  maxQty,
  onAdd,
}: {
  productName: string;
  maxQty: number;
  onAdd: (qty: number, damaged: boolean) => void;
}) {
  const { t } = useLang();
  const [qty, setQty] = useState(1);
  const [damaged, setDamaged] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(Math.min(Math.max(1, qty), maxQty), damaged);
      }}
    >
      <div>
        <div className="mb-1 text-sm font-semibold text-foreground">{productName}</div>
        <label className="label">{t("qty")}</label>
        <input
          type="number"
          min="1"
          max={maxQty}
          className="input max-w-[110px]"
          value={qty}
          onChange={(e) => setQty(Number(e.target.value) || 1)}
        />
      </div>
      <label className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />
        {t("damaged")}
      </label>
      <button type="submit" className="btn-secondary btn-sm">{t("add")}</button>
    </form>
  );
}

function AdminSettlement() {
  const { t } = useLang();
  const data = useQuery({ queryKey: ["admin-settlement"], queryFn: () => fetchAdminData() });

  if (data.isLoading || !data.data) {
    return (
      <AppShell title={t("settlement_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  const d = data.data;

  return (
    <AppShell title={t("settlement_title")}>
      <h1 className="page-title mb-4">{t("settlement_title")}</h1>
      <div className="card mb-4">
        <h2 className="card-title mb-3">{t("dash_per_salesman")}</h2>
        {d.salesmen.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          d.salesmen.map((s) => {
            const sales = d.sales.filter((x) => x.salesman_id === s.id);
            const payments = d.payments.filter((x) => x.salesman_id === s.id);
            const deposits = d.deposits.filter((x) => x.salesman_id === s.id);
            const cash =
              sales.reduce((a, x) => a + toNumber(x.paid_amount), 0) +
              payments.reduce((a, x) => a + toNumber(x.amount), 0);
            const dep = deposits.reduce((a, x) => a + toNumber(x.amount), 0);
            const withStock = d.imeiUnits.filter(
              (u) => u.status === "with_salesman" && u.current_salesman === s.id,
            ).length;
            return (
              <div key={s.id} className="row">
                <div>
                  <div className="font-medium text-foreground">{s.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("dash_issued")}: {withStock} {t("qty")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-warning-foreground">
                    {t("expected_cash")}: {formatBDT(Math.max(0, cash - dep))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("dash_deposited")}: {formatBDT(dep)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
