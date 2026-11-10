import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ImeiScanner } from "@/components/ImeiScanner";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { usePosting, fetchAccounting } from "@/lib/accounting";
import { findImei } from "@/lib/offline";
import { saveImeiScanHistory } from "@/lib/imei-history";
import { formatBDT } from "@/lib/money";
import { displayBusinessDate } from "@/lib/business-time";

export const Route = createFileRoute("/_authenticated/stock-receipt")({
  head: () => ({
    meta: [
      { title: "Stock receipt — FE MANAGEMENT" },
      { name: "description", content: "Receive and cost inventory with atomic stock posting." },
    ],
  }),
  component: StockReceiptPage,
});

interface ReceiptLine {
  productId: string;
  quantity: string;
  unitCost: string;
  units: { id: string; imei: string }[];
}

function StockReceiptPage() {
  const { lang, t } = useLang();
  const role = useMyRole();
  const client = useQueryClient();
  const post = usePosting();
  const data = useQuery({ queryKey: ["stock-receipt"], queryFn: fetchAccounting });
  const [source, setSource] = useState<"purchase" | "opening">("purchase");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [units, setUnits] = useState<ReceiptLine["units"]>([]);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [receiptPage, setReceiptPage] = useState(0);
  const bn = lang === "bn";
  const products = data.data?.products.filter((product) => product.is_active) ?? [];
  const selectedProduct = products.find((product) => product.id === productId);
  const submittedProducts = useMemo(() => new Set(lines.map((line) => line.productId)), [lines]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!role.data?.isAdmin || !role.data.isActive) throw new Error(t("no_access"));
      if (lines.length === 0)
        throw new Error(bn ? "অন্তত একটি পণ্য যোগ করুন" : "Add at least one product");
      if (source === "purchase" && !supplier.trim())
        throw new Error(bn ? "সরবরাহকারীর নাম লিখুন" : "Enter a supplier");
      return post("inventory_receipt", {
        source,
        supplier: supplier.trim(),
        note: note.trim(),
        items: lines.map((line) => ({
          product_id: line.productId,
          quantity: line.units.length || Number(line.quantity),
          unit_cost: Number(line.unitCost),
          units: line.units,
        })),
      });
    },
    onSuccess: async () => {
      toast.success(bn ? "স্টক গ্রহণ সংরক্ষিত হয়েছে" : "Stock receipt saved");
      setLines([]);
      setReceiptPage(0);
      setSupplier("");
      setNote("");
      await client.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const checkImei = async (imei: string) => {
    if (
      units.some((unit) => unit.imei === imei) ||
      lines.some((line) => line.units.some((unit) => unit.imei === imei))
    ) {
      return { ok: false, message: t("imei_duplicate") };
    }
    const result = await findImei(imei);
    return result.data
      ? { ok: false, message: t("imei_duplicate") }
      : { ok: true, message: t("imei_valid") };
  };

  function addLine() {
    if (!selectedProduct || submittedProducts.has(selectedProduct.id)) return;
    const count = selectedProduct.category === "smartphone" ? units.length : Number(quantity);
    const cost = Number(unitCost);
    if (
      !Number.isInteger(count) ||
      count <= 0 ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      Math.abs(cost * 100 - Math.round(cost * 100)) > 0.000001
    ) {
      toast.error(
        bn ? "পরিমাণ ও একক ক্রয়মূল্য যাচাই করুন" : "Enter a valid quantity and unit cost",
      );
      return;
    }
    setLines((current) => [
      ...current,
      {
        productId: selectedProduct.id,
        quantity: String(count),
        unitCost: String(cost),
        units: [...units],
      },
    ]);
    setProductId("");
    setQuantity("");
    setUnitCost("");
    setUnits([]);
  }

  if (data.error) throw data.error;

  return (
    <AppShell title={bn ? "স্টক গ্রহণ" : "Stock receipt"}>
      <h1 className="page-title mb-4">
        {bn ? "স্টক গ্রহণ ও ক্রয়মূল্য" : "Receive stock & record cost"}
      </h1>
      {role.isLoading || data.isLoading ? (
        <p>{t("loading")}</p>
      ) : !role.data?.isAdmin ? (
        <p role="alert" className="text-destructive">
          {t("no_access")}
        </p>
      ) : (
        <>
          <section className="card mb-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {bn
                ? "প্রথমবার button phone-এর মজুত দিতে Opening balance বেছে প্রকৃত হাতে থাকা পরিমাণ লিখুন। প্রতিটি গ্রহণ সংরক্ষিত ইতিহাস; এটি এখনো লাভ/মজুত মূল্যায়ন হিসাব নয়।"
                : "To initialize button-phone stock, choose Opening balance and enter the physically counted quantity. Receipts are kept as history; this does not calculate inventory valuation or profit."}
            </p>
            <label className="block">
              <span className="label">{bn ? "গ্রহণের ধরন" : "Receipt type"}</span>
              <select
                className="input"
                value={source}
                onChange={(event) =>
                  setSource(event.target.value === "opening" ? "opening" : "purchase")
                }
              >
                <option value="purchase">{bn ? "ক্রয়" : "Purchase"}</option>
                <option value="opening">{bn ? "প্রারম্ভিক মজুত" : "Opening balance"}</option>
              </select>
            </label>
            {source === "purchase" && (
              <label className="block">
                <span className="label">{bn ? "সরবরাহকারী" : "Supplier"}</span>
                <input
                  className="input"
                  maxLength={160}
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">{bn ? "পণ্য" : "Product"}</span>
                <select
                  className="input"
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setUnits([]);
                  }}
                >
                  <option value="">—</option>
                  {products.map((product) => (
                    <option
                      key={product.id}
                      value={product.id}
                      disabled={submittedProducts.has(product.id)}
                    >
                      {product.name} · {product.model || product.category}
                    </option>
                  ))}
                </select>
              </label>
              {selectedProduct?.category === "smartphone" ? (
                <div>
                  <span className="label">
                    {bn ? "IMEI" : "IMEIs"} · {units.length}
                  </span>
                  <ImeiScanner
                    hint={t("imei_list_hint")}
                    check={checkImei}
                    onScanEvent={(event) => saveImeiScanHistory(event, productId)}
                    onAccepted={(imei) =>
                      setUnits((current) => [...current, { id: crypto.randomUUID(), imei }])
                    }
                  />
                </div>
              ) : (
                <label className="block">
                  <span className="label">{bn ? "পরিমাণ" : "Quantity"}</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
              )}
              <label className="block">
                <span className="label">
                  {bn ? "প্রতি পিস ক্রয়মূল্য (৳)" : "Purchase cost per unit (BDT)"}
                </span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                />
              </label>
            </div>
            {!!units.length && (
              <div className="flex flex-wrap gap-1">
                {units.map((unit) => (
                  <Button
                    key={unit.id}
                    type="button"
                    variant="ghost"
                    className="badge-mut"
                    onClick={() =>
                      setUnits((current) => current.filter((item) => item.id !== unit.id))
                    }
                  >
                    {unit.imei} ×
                  </Button>
                ))}
              </div>
            )}
            <label className="block">
              <span className="label">
                {t("note")} {bn ? "(ঐচ্ছিক)" : "(optional)"}
              </span>
              <input
                className="input"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedProduct || submittedProducts.has(selectedProduct.id)}
              onClick={addLine}
            >
              {bn ? "তালিকায় যোগ করুন" : "Add item"}
            </Button>
          </section>
          {lines.length > 0 && (
            <section className="card mb-4">
              <h2 className="card-title mb-2">{bn ? "গ্রহণের তালিকা" : "Receipt items"}</h2>
              {lines.map((line) => {
                const product = products.find((item) => item.id === line.productId);
                const count = Number(line.quantity);
                return (
                  <div key={line.productId} className="row">
                    <div className="min-w-0">
                      <p className="font-medium">{product?.name ?? line.productId}</p>
                      <p className="text-xs text-muted-foreground">
                        {count} × {formatBDT(Number(line.unitCost))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <strong>{formatBDT(count * Number(line.unitCost))}</strong>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLines((current) =>
                            current.filter((item) => item.productId !== line.productId),
                          )
                        }
                      >
                        {t("delete")}
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button
                className="mt-4 w-full"
                disabled={submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending
                  ? t("loading")
                  : bn
                    ? "স্টক গ্রহণ নিশ্চিত করুন"
                    : "Confirm stock receipt"}
              </Button>
            </section>
          )}
          {data.data && (
            <section>
              <h2 className="card-title mb-2">
                {bn ? "সাম্প্রতিক স্টক গ্রহণ" : "Recent stock receipts"}
              </h2>
              {[...data.data.inventoryReceipts]
                .slice(receiptPage * 10, receiptPage * 10 + 10)
                .map((receipt) => {
                  const rows =
                    data.data?.inventoryReceiptItems.filter(
                      (item) => item.receipt_id === receipt.id,
                    ) ?? [];
                  const total = rows.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
                  return (
                    <article key={receipt.id} className="row border-b border-border">
                      <div>
                        <p className="font-medium">
                          {receipt.source === "opening"
                            ? bn
                              ? "প্রারম্ভিক মজুত"
                              : "Opening balance"
                            : receipt.supplier || (bn ? "ক্রয়" : "Purchase")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {displayBusinessDate(receipt.received_at, bn ? "bn-BD" : "en-GB")} ·{" "}
                          {rows.length} {bn ? "ধরন" : "products"}
                        </p>
                      </div>
                      <strong>{formatBDT(total)}</strong>
                    </article>
                  );
                })}
              <div className="mt-3 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={receiptPage === 0}
                  onClick={() => setReceiptPage((page) => page - 1)}
                >
                  {bn ? "আগের" : "Previous"}
                </Button>
                <span className="text-sm">
                  {receiptPage + 1} /{" "}
                  {Math.max(1, Math.ceil(data.data.inventoryReceipts.length / 10))}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(receiptPage + 1) * 10 >= data.data.inventoryReceipts.length}
                  onClick={() => setReceiptPage((page) => page + 1)}
                >
                  {bn ? "পরের" : "Next"}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
