import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ImeiScanner } from "@/components/ImeiScanner";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { formatBDT } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Pencil, Power, Trash2, ScanBarcode } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({
    meta: [
      { title: "প্রোডাক্ট — FE MANAGEMENT" },
      { name: "description", content: "Product list with prices, categories and IMEI stock." },
      { property: "og:title", content: "প্রোডাক্ট — FE MANAGEMENT" },
      {
        property: "og:description",
        content: "Product list with prices, categories and IMEI stock.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const { t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["products-page"],
    queryFn: async () => {
      const [productsRes, imeiRes] = await Promise.all([
        supabase.from("products").select("*").order("created_at", { ascending: false }),
        supabase.from("imei_units").select("id, product_id, imei, status, current_salesman"),
      ]);
      return { products: productsRes.data ?? [], imeiUnits: imeiRes.data ?? [] };
    },
  });

  const isAdmin = role.data?.isAdmin === true;

  return (
    <AppShell title={t("products_title")}>
      <h1 className="page-title mb-4">{t("products_title")}</h1>
      {isAdmin ? <AddProduct onDone={() => queryClient.invalidateQueries({ queryKey: ["products-page"] })} /> : null}
      <ProductList
        data={data.data}
        isAdmin={isAdmin}
        onChange={() => queryClient.invalidateQueries({ queryKey: ["products-page"] })}
      />
    </AppShell>
  );
}

interface ProductRow {
  id: string;
  name: string;
  model: string;
  price: number;
  category: string;
  is_active: boolean;
}

function AddProduct({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<"smartphone" | "button_phone">("smartphone");
  const [imeis, setImeis] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { data: product, error } = await supabase
        .from("products")
        .insert({ name, model, price: Number(price) || 0, category })
        .select("id")
        .single();
      if (error) throw error;
      if (category === "smartphone" && imeis.length > 0) {
        const { error: imeiError } = await supabase.from("imei_units").insert(
          imeis.map((imei) => ({ product_id: product.id, imei })),
        );
        if (imeiError) throw imeiError;
      }
    },
    onSuccess: () => {
      toast.success(t("product_saved"));
      setName("");
      setModel("");
      setPrice("");
      setImeis([]);
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkNewImei = async (code: string) => {
    if (imeis.includes(code)) return { ok: false, message: t("imei_duplicate") };
    const { data: unit } = await supabase
      .from("imei_units")
      .select("id")
      .eq("imei", code)
      .maybeSingle();
    if (unit) return { ok: false, message: t("imei_duplicate") };
    return { ok: true, message: t("imei_valid") };
  };

  if (!open) {
    return (
      <Button type="button" className="btn-primary mb-4" onClick={() => setOpen(true)}>
        + {t("add_product")}
      </Button>
    );
  }

  return (
    <div className="card mb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="p-name">{t("name")}</label>
          <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-model">{t("model")} {t("optional")}</label>
          <input id="p-model" className="input" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="p-price">{t("price")}</label>
            <input id="p-price" type="number" min="0" className="input" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-cat">{t("category")}</label>
            <select
              id="p-cat"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as "smartphone" | "button_phone")}
            >
              <option value="smartphone">{t("cat_smartphone")}</option>
              <option value="button_phone">{t("cat_button_phone")}</option>
            </select>
          </div>
        </div>

        {category === "smartphone" ? (
          <div className="mb-3">
            <ImeiScanner
              hint={t("imei_list_hint")}
              check={checkNewImei}
              onAccepted={(code) => setImeis((prev) => [...prev, code])}
            />
            {imeis.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {imeis.map((imei) => (
                  <Button
                    variant="ghost"
                    key={imei}
                    type="button"
                    className="badge-mut hover:text-destructive"
                    onClick={() => setImeis((prev) => prev.filter((x) => x !== imei))}
                    title={t("delete")}
                  >
                    {imei} ×
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" className="btn-primary" disabled={save.isPending}>
            {t("save")}
          </Button>
          <Button type="button" className="btn-outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ProductList({
  data,
  isAdmin,
  onChange,
}: {
  data: { products: ProductRow[]; imeiUnits: { id: string; product_id: string; imei: string; status: string }[] } | undefined;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState<(Omit<ProductRow, "price"> & { price: string }) | null>(null);
  const [addImeiFor, setAddImeiFor] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: async (row: Omit<ProductRow, "price"> & { price: string }) => {
      const { error } = await supabase
        .from("products")
        .update({ name: row.name, model: row.model, price: Number(row.price) })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(null);
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (row: ProductRow) => {
      const { error } = await supabase
        .from("products")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: ProductRow) => {
      const { error } = await supabase.from("products").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  const addImei = useMutation({
    mutationFn: async ({ productId, imei }: { productId: string; imei: string }) => {
      const { error } = await supabase.from("imei_units").insert({ product_id: productId, imei });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-page"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkStockImei = async (code: string) => {
    const { data: unit } = await supabase
      .from("imei_units")
      .select("id, product_id, status")
      .eq("imei", code)
      .maybeSingle();
    if (unit) return { ok: false, message: t("imei_duplicate") };
    return { ok: true, message: t("imei_valid") };
  };

  if (!data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (data.products.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("no_products")}</p>;
  }

  return (
    <div className="card">
      {data.products.map((p) => {
        const stock = data.imeiUnits.filter(
          (u) => u.product_id === p.id && u.status === "in_dealer_stock",
        ).length;
        return (
          <div key={p.id} className="grid min-w-0 gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            {editing?.id === p.id ? (
              <form
                className="grid w-full min-w-0 gap-2 sm:col-span-2 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate(editing);
                }}
              >
                <input
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <input
                  className="input"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                />
                <Button type="submit" className="btn-primary btn-sm">{t("save")}</Button>
                <Button type="button" className="btn-outline btn-sm" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
              </form>
            ) : (
              <>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{p.name}</span>
                    <span className="badge-mut">
                      {p.category === "smartphone" ? t("cat_smartphone") : t("cat_button_phone")}
                    </span>
                    {!p.is_active ? <span className="badge-warn">{t("inactive")}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.model ? `${p.model} · ` : ""}
                    {formatBDT(Number(p.price))}
                    {p.category === "smartphone" ? ` · ${t("in_stock")}: ${stock}` : ""}
                  </div>
                </div>
                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" type="button" className="h-11 w-11" title={t("edit")} aria-label={t("edit")} onClick={() => setEditing({ ...p, price: String(p.price) })}>
                      <Pencil />
                    </Button>
                    {p.category === "smartphone" ? (
                      <Button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setAddImeiFor(addImeiFor === p.id ? null : p.id)}
                      >
                        <ScanBarcode />{t("add_imei")}
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon" type="button" className="h-11 w-11" title={p.is_active ? t("deactivate") : t("activate")} aria-label={p.is_active ? t("deactivate") : t("activate")} onClick={() => toggleActive.mutate(p)}>
                      <Power />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="h-11 w-11 text-destructive"
                      title={t("delete")}
                      aria-label={t("delete")}
                      onClick={() => {
                        if (window.confirm(t("confirmDelete"))) remove.mutate(p);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        );
      })}
      {addImeiFor ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <ImeiScanner
            hint={t("imei_list_hint")}
            check={checkStockImei}
            onAccepted={(code) => addImei.mutate({ productId: addImeiFor, imei: code })}
          />
        </div>
      ) : null}
    </div>
  );
}
