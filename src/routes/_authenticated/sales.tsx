import { Button } from "@/components/ui/button";
import { usePosting, validCash, fetchAccounting } from "@/lib/accounting";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ImeiScanner } from "@/components/ImeiScanner";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { formatBDT, saleDue, toNumber } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "বিক্রি — FE MANAGEMENT" },
      { name: "description", content: "Record sales to retailers with cash and dues." },
      { property: "og:title", content: "বিক্রি — FE MANAGEMENT" },
      { property: "og:description", content: "Record sales to retailers with cash and dues." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesPage,
});

interface DraftItem {
  product: { id: string; name: string; category: string; price: number };
  qty: number;
  unitPrice: number;
  units: { id: string; imei: string }[];
}

function SalesPage() {
  const { t } = useLang();
  const role = useMyRole();

  if (role.isLoading || !role.data) {
    return (
      <AppShell title={t("sales_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  return role.data.isAdmin ? <AdminSales /> : <SalesmanSales userId={role.data.userId} />;
}

function AdminSales() {
  const { t } = useLang();
  const data = useQuery({
    queryKey: ["admin-sales"],
    queryFn: async () => {
      const [salesRes, profilesRes, retailersRes] = await Promise.all([
        supabase
          .from("sales")
          .select("id, salesman_id, retailer_id, total_amount, paid_amount, sold_at")
          .order("sold_at", { ascending: false })
          .limit(30),
        supabase.from("profiles").select("id, full_name"),
        supabase.from("retailers").select("id, name"),
      ]);
      return {
        sales: salesRes.data ?? [],
        profiles: profilesRes.data ?? [],
        retailers: retailersRes.data ?? [],
      };
    },
  });

  const d = data.data;
  return (
    <AppShell title={t("all_sales")}>
      <h1 className="page-title mb-4">{t("all_sales")}</h1>
      <div className="card">
        {!d || d.sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          d.sales.map((s) => (
            <div key={s.id} className="row">
              <div>
                <div className="font-medium text-foreground">
                  {d.retailers.find((r) => r.id === s.retailer_id)?.name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.profiles.find((p) => p.id === s.salesman_id)?.full_name ?? "—"} ·{" "}
                  {new Date(s.sold_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatBDT(toNumber(s.total_amount))}</div>
                <div className="text-xs text-warning-foreground">
                  {t("due")}: {formatBDT(saleDue(toNumber(s.total_amount), toNumber(s.paid_amount)))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function SalesmanSales({ userId }: { userId: string }) {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const post = usePosting();
  const [retailerId, setRetailerId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickProduct, setPickProduct] = useState("");
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");

  const data = useQuery({
    queryKey: ["sales-page", userId],
    queryFn: async () => {
      const [retailersRes, productsRes, salesRes] = await Promise.all([
        supabase.from("retailers").select("id, name").eq("is_active", true).order("name"),
        supabase.from("products").select("id, name, category, price").eq("is_active", true).order("name"),
        supabase
          .from("sales")
          .select("id, retailer_id, total_amount, paid_amount, sold_at")
          .eq("salesman_id", userId)
          .order("sold_at", { ascending: false })
          .limit(15),
      ]);
      const retailerIds = (salesRes.data ?? []).map((s) => s.retailer_id);
      const [retailerNames, salesItemsRes] = await Promise.all([
        retailerIds.length
          ? supabase.from("retailers").select("id, name").in("id", retailerIds)
          : Promise.resolve({ data: [] as never[] }),
        salesRes.data && salesRes.data.length
          ? supabase
              .from("sale_items")
              .select("id, sale_id, quantity, unit_price, product_id")
              .in("sale_id", salesRes.data.map((s) => s.id))
          : Promise.resolve({ data: [] as never[] }),
      ]);
      return {
        retailers: retailersRes.data ?? [],
        products: productsRes.data ?? [],
        mySales: salesRes.data ?? [],
        retailerNames: retailerNames.data ?? [],
        saleItems: salesItemsRes.data ?? [],
      };
    },
  });

  const d = data.data;

  const total = items.reduce(
    (a, i) => a + (i.product.category === "button_phone" ? i.qty : i.units.length) * i.unitPrice,
    0,
  );
  const paid = Number(cash) || 0;

  const submit = useMutation({
    mutationFn: async () => {
      if (!retailerId || items.length === 0) throw new Error(t("noData"));
      if (!validCash(paid,total,true)) throw new Error(t('invalid_cash'));
      return post('sale', { retailer_id:retailerId, paid_amount:paid, note, items:items.map(i=>({ product_id:i.product.id, quantity:i.qty, unit_price:i.unitPrice, unit_ids:i.units.map(u=>u.id) })) });
    },
    onSuccess: () => {
      toast.success(t("sale_saved"));
      setItems([]);
      setRetailerId("");
      setCash("");
      setNote("");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addItem(product: { id: string; name: string; category: string; price: number }) {
    if (items.some((i) => i.product.id === product.id)) return;
    setItems((prev) => [
      ...prev,
      { product, qty: 1, unitPrice: Number(product.price) || 0, units: [] },
    ]);
  }

  const checkImei = async (code: string, item: DraftItem) => {
    const { data: unit } = await supabase
      .from("imei_units")
      .select("id, product_id, status, current_salesman")
      .eq("imei", code)
      .maybeSingle();
    if (!unit || unit.status !== "with_salesman" || unit.current_salesman !== userId) {
      return { ok: false, message: t("imei_not_with_you") };
    }
    if (unit.product_id !== item.product.id) {
      return { ok: false, message: t("imei_unknown") };
    }
    if (items.some((i) => i.units.some((u) => u.id === unit.id))) {
      return { ok: false, message: t("imei_duplicate") };
    }
    return { ok: true, message: t("imei_valid") };
  };

  return (
    <AppShell title={t("sales_title")}>
      <h1 className="page-title mb-4">{t("new_sale")}</h1>

      <div className="card mb-4">
        <div className="field">
          <label className="label" htmlFor="s-retailer">{t("select_retailer")}</label>
          <select
            id="s-retailer"
            className="input"
            value={retailerId}
            onChange={(e) => setRetailerId(e.target.value)}
          >
            <option value="">—</option>
            {(d?.retailers ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="field flex gap-2">
          <select className="input" value={pickProduct} onChange={(e) => setPickProduct(e.target.value)}>
            <option value="">{t("add_item_sale")}…</option>
            {(d?.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button
            type="button"
            className="btn-secondary shrink-0"
            disabled={!pickProduct || !d}
            onClick={() => {
              const p = d?.products.find((x) => x.id === pickProduct);
              if (p) addItem(p);
              setPickProduct("");
            }}
          >
            {t("add")}
          </Button>
        </div>

        {items.map((item) => (
          <div key={item.product.id} className="mb-3 rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold text-foreground">{item.product.name}</div>
              <Button
                type="button"
                className="btn-ghost btn-sm text-destructive"
                onClick={() => setItems((prev) => prev.filter((i) => i.product.id !== item.product.id))}
              >
                {t("delete")}
              </Button>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              {item.product.category === "button_phone" ? (
                <div>
                  <label className="label">{t("qty")}</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={item.qty}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.product.id === item.product.id
                            ? { ...i, qty: Math.max(1, Number(e.target.value) || 1) }
                            : i,
                        ),
                      )
                    }
                  />
                </div>
              ) : null}
              <div>
                <label className="label">{t("unit_price")}</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={item.unitPrice}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((i) =>
                        i.product.id === item.product.id
                          ? { ...i, unitPrice: Math.max(0, Number(e.target.value) || 0) }
                          : i,
                      ),
                    )
                  }
                />
              </div>
            </div>
            {item.product.category === "smartphone" ? (
              <>
                <ImeiScanner
                  hint={t("scan_imei_own")}
                  check={(code) => checkImei(code, item)}
                  onAccepted={(code) =>
                    supabase
                      .from("imei_units")
                      .select("id")
                      .eq("imei", code)
                      .maybeSingle()
                      .then(({ data: unit }) => {
                        if (unit) {
                          setItems((prev) =>
                            prev.map((i) =>
                              i.product.id === item.product.id
                                ? { ...i, units: [...i.units, { id: unit.id, imei: code }] }
                                : i,
                            ),
                          );
                        }
                      })
                  }
                />
                {item.units.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.units.map((u) => (
                      <span key={u.id} className="badge-ok">{u.imei}</span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ))}

        <div className="mb-2 flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2">
          <span className="text-sm font-semibold">{t("sale_total")}</span>
          <span className="text-lg font-bold">{formatBDT(total)}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-cash">{t("cash_received")}</label>
          <input
            max={total}
            step="0.01"
            id="s-cash"
            type="number"
            min="0"
            className="input"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="mb-3 flex items-center justify-between rounded-xl bg-warning/15 px-3 py-2">
          <span className="text-sm font-semibold text-warning-foreground">{t("sale_due")}</span>
          <span className="text-lg font-bold text-warning-foreground">
            {formatBDT(saleDue(total, paid))}
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-note">{t("note")} {t("optional")}</label>
          <input id="s-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <Button
          type="button"
          className="btn-primary w-full"
          disabled={!retailerId || items.length === 0 || !validCash(paid,total,true) || items.some(i=>i.product.category === "smartphone" && i.units.length===0) || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {t("save_sale")}
        </Button>
      </div>

      <section className="card">
        <h2 className="card-title mb-3">{t("my_sales")}</h2>
        {!d || d.mySales.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          d.mySales.map((s) => (
            <div key={s.id} className="row">
              <div>
                <div className="font-medium text-foreground">
                  {d.retailerNames.find((r) => r.id === s.retailer_id)?.name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.sold_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatBDT(toNumber(s.total_amount))}</div>
                <div className="text-xs text-warning-foreground">
                  {t("due")}: {formatBDT(saleDue(toNumber(s.total_amount), toNumber(s.paid_amount)))}
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}
