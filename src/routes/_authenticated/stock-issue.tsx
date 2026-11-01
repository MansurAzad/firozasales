import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ImeiScanner } from "@/components/ImeiScanner";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/stock-issue")({
  head: () => ({
    meta: [
      { title: "মাল ইস্যু — মোবাইল হিসাব" },
      { name: "description", content: "Issue stock to salesmen, with IMEI scanning." },
      { property: "og:title", content: "মাল ইস্যু — মোবাইল হিসাব" },
      { property: "og:description", content: "Issue stock to salesmen, with IMEI scanning." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockIssuePage,
});

interface DraftItem {
  product: { id: string; name: string; category: string; price: number };
  qty: number;
  units: { id: string; imei: string }[];
}

function StockIssuePage() {
  const { t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["stock-issue-page"],
    queryFn: async () => {
      const [salesmenRoles, productsRes, issuesRes] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "salesman"),
        supabase.from("products").select("id, name, category, price").eq("is_active", true).order("name"),
        supabase
          .from("stock_issues")
          .select("id, salesman_id, issued_at")
          .order("issued_at", { ascending: false })
          .limit(10),
      ]);
      const ids = (salesmenRoles.data ?? []).map((r) => r.user_id);
      const [profilesRes, issueItemsRes] = await Promise.all([
        ids.length
          ? supabase.from("profiles").select("id, full_name, is_active").in("id", ids)
          : Promise.resolve({ data: [] as never[] }),
        issuesRes.data && issuesRes.data.length
          ? supabase
              .from("stock_issue_items")
              .select("id, issue_id, quantity")
              .in("issue_id", issuesRes.data.map((i) => i.id))
          : Promise.resolve({ data: [] as never[] }),
      ]);
      return {
        salesmen: profilesRes.data ?? [],
        products: productsRes.data ?? [],
        issues: issuesRes.data ?? [],
        issueItems: issueItemsRes.data ?? [],
      };
    },
  });

  const [salesmanId, setSalesmanId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickProduct, setPickProduct] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      if (!role.data || !salesmanId || items.length === 0) {
        throw new Error(t("noData"));
      }
      const { data: issue, error } = await supabase
        .from("stock_issues")
        .insert({ salesman_id: salesmanId, issued_by: role.data.userId })
        .select("id")
        .single();
      if (error) throw error;

      for (const item of items) {
        if (item.product.category === "button_phone") {
          const { error: e } = await supabase.from("stock_issue_items").insert({
            issue_id: issue.id,
            product_id: item.product.id,
            quantity: item.qty,
          });
          if (e) throw e;
        } else {
          for (const unit of item.units) {
            const { error: e } = await supabase.from("stock_issue_items").insert({
              issue_id: issue.id,
              product_id: item.product.id,
              quantity: 1,
              imei_unit_id: unit.id,
            });
            if (e) throw e;
            const { error: rpcError } = await supabase.rpc("issue_imei", {
              p_imei: unit.imei,
              p_issue_id: issue.id,
            });
            if (rpcError) throw rpcError;
          }
        }
      }
      return issue.id;
    },
    onSuccess: () => {
      toast.success(t("issue_created"));
      setItems([]);
      setSalesmanId("");
      queryClient.invalidateQueries({ queryKey: ["stock-issue-page"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role.isLoading) {
    return (
      <AppShell title={t("stock_issue_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  if (!role.data?.isAdmin) {
    return (
      <AppShell title={t("stock_issue_title")}>
        <div className="card">
          <p className="text-sm text-muted-foreground">{t("no_access")}</p>
        </div>
      </AppShell>
    );
  }
  const d = data.data;
  if (!d) return null;

  const salesmen = d.salesmen.filter((s) => s.is_active);

  function addItem(product: { id: string; name: string; category: string; price: number }) {
    if (items.some((i) => i.product.id === product.id)) return;
    setItems((prev) => [...prev, { product, qty: 1, units: [] }]);
  }

  const checkImei = async (code: string, item: DraftItem) => {
    const { data: unit } = await supabase
      .from("imei_units")
      .select("id, product_id, status")
      .eq("imei", code)
      .maybeSingle();
    if (!unit) return { ok: false, message: t("imei_not_in_stock") };
    if (unit.status !== "in_dealer_stock") {
      return { ok: false, message: t("imei_not_in_stock") };
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
    <AppShell title={t("stock_issue_title")}>
      <h1 className="page-title mb-4">{t("stock_issue_title")}</h1>

      <div className="card mb-4">
        <div className="field">
          <label className="label" htmlFor="si-salesman">{t("select_salesman")}</label>
          <select
            id="si-salesman"
            className="input"
            value={salesmanId}
            onChange={(e) => setSalesmanId(e.target.value)}
          >
            <option value="">—</option>
            {salesmen.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || s.id}
              </option>
            ))}
          </select>
        </div>

        <div className="field flex gap-2">
          <select
            className="input"
            value={pickProduct}
            onChange={(e) => setPickProduct(e.target.value)}
          >
            <option value="">{t("add_item")}…</option>
            {d.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={!pickProduct}
            onClick={() => {
              const p = d.products.find((x) => x.id === pickProduct);
              if (p) addItem(p);
              setPickProduct("");
            }}
          >
            {t("add")}
          </button>
        </div>

        {items.map((item) => (
          <div key={item.product.id} className="mb-3 rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold text-foreground">{item.product.name}</div>
              <button
                type="button"
                className="btn-ghost btn-sm text-destructive"
                onClick={() => setItems((prev) => prev.filter((i) => i.product.id !== item.product.id))}
              >
                {t("delete")}
              </button>
            </div>
            {item.product.category === "button_phone" ? (
              <div className="flex items-center gap-2">
                <label className="label mb-0">{t("qty")}</label>
                <input
                  type="number"
                  min="1"
                  className="input max-w-[100px]"
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
            ) : (
              <>
                <ImeiScanner
                  hint={t("scan_imei_stock")}
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
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={!salesmanId || items.length === 0 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {t("issue_stock")}
        </button>
      </div>

      <section className="card">
        <h2 className="card-title mb-3">{t("recent_issues")}</h2>
        {d.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          d.issues.map((issue) => {
            const qty = d.issueItems
              .filter((i) => i.issue_id === issue.id)
              .reduce((a, i) => a + i.quantity, 0);
            const name = d.salesmen.find((s) => s.id === issue.salesman_id)?.full_name ?? "—";
            return (
              <div key={issue.id} className="row">
                <div>
                  <div className="font-medium text-foreground">{name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(issue.issued_at).toLocaleString()}
                  </div>
                </div>
                <span className="badge-mut">{qty} {t("qty")}</span>
              </div>
            );
          })
        )}
      </section>
    </AppShell>
  );
}
