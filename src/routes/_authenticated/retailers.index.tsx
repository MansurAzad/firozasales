import { fetchAccounting } from "@/lib/accounting";
import { Button } from "@/components/ui/button";
import { Pencil, Power, Trash2 } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { formatBDT, toNumber } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/retailers/")({
  head: () => ({
    meta: [
      { title: "রিটেইলার — FE MANAGEMENT" },
      { name: "description", content: "Retailer list with balances and ledgers." },
      { property: "og:title", content: "রিটেইলার — FE MANAGEMENT" },
      { property: "og:description", content: "Retailer list with balances and ledgers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RetailersPage,
});

interface RetailerRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  is_active: boolean;
}

function RetailersPage() {
  const { t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["retailers-page", role.data?.userId],
    queryFn: async () => {
      return fetchAccounting();
    },
  });

  const isAdmin = role.data?.isAdmin === true;

  return (
    <AppShell title={t("retailers_title")}>
      <h1 className="page-title mb-4">{t("retailers_title")}</h1>
      {isAdmin ? (
        <AddRetailer onDone={() => queryClient.invalidateQueries({ queryKey: ["retailers-page"] })} />
      ) : null}
      <RetailerList
        data={data.data}
        isAdmin={isAdmin}
        userId={role.data?.userId ?? ""}
        onChange={() => queryClient.invalidateQueries({ queryKey: ["retailers-page"] })}
      />
    </AppShell>
  );
}

function AddRetailer({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("retailers")
        .insert({ name, phone, address });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("retailer_saved"));
      setName("");
      setPhone("");
      setAddress("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button type="button" className="btn-primary mb-4" onClick={() => setOpen(true)}>
        + {t("add_retailer")}
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
          <label className="label" htmlFor="r-name">{t("name")}</label>
          <input id="r-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="r-phone">{t("phone")}</label>
            <input id="r-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="r-address">{t("address")}</label>
            <input id="r-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="btn-primary" disabled={save.isPending}>{t("save")}</Button>
          <Button type="button" className="btn-outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
        </div>
      </form>
    </div>
  );
}

function RetailerList({
  data,
  isAdmin,
  userId,
  onChange,
}: {
  data:
    | {
        retailers: RetailerRow[];
        sales: { id: string; retailer_id: string; salesman_id: string; total_amount: number; paid_amount: number }[];
        payments: { id: string; retailer_id: string; salesman_id: string; amount: number }[];
      }
    | undefined;
  isAdmin: boolean;
  userId: string;
  onChange: () => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState<RetailerRow | null>(null);

  const update = useMutation({
    mutationFn: async (row: RetailerRow) => {
      const { error } = await supabase
        .from("retailers")
        .update({ name: row.name, phone: row.phone, address: row.address })
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
    mutationFn: async (row: RetailerRow) => {
      const { error } = await supabase
        .from("retailers")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: RetailerRow) => {
      const { error } = await supabase.from("retailers").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (data.retailers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  return (
    <div className="card">
      {data.retailers.map((r) => {
        return (
          <div key={r.id} className="grid min-w-0 gap-3 border-b border-border py-4 last:border-b-0">
            {editing?.id === r.id ? (
              <form
                className="grid w-full min-w-0 gap-2 sm:grid-cols-3"
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
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                />
                <input
                  className="input"
                  value={editing.address}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                />
                <Button type="submit" className="btn-primary btn-sm">{t("save")}</Button>
                <Button type="button" className="btn-outline btn-sm" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
              </form>
            ) : (
              <>
                <Link to="/retailers/$id" params={{ id: r.id }} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{r.name}</span>
                    {!r.is_active ? <span className="badge-warn">{t("inactive")}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.phone || "—"}
                    {` · ${t("ledger")}`}
                  </div>
                </Link>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <RetailerBalance retailerId={r.id} isAdmin={isAdmin} userId={userId} data={data} />
                  {isAdmin ? (
                    <div className="flex shrink-0 items-center">
                      <Button variant="ghost" size="icon" className="h-11 w-11" type="button" aria-label={t("edit")} title={t("edit")} onClick={() => setEditing(r)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11" type="button" aria-label={r.is_active ? t("deactivate") : t("activate")} title={r.is_active ? t("deactivate") : t("activate")} onClick={() => toggleActive.mutate(r)} disabled={toggleActive.isPending}>
                        <Power />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={t("delete")}
                        title={t("delete")}
                        className="h-11 w-11 text-destructive"
                        onClick={() => {
                          if (window.confirm(t("confirmDelete"))) remove.mutate(r);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : <Button asChild variant="outline" className="whitespace-normal"><Link to="/retailers/$id" params={{ id: r.id }}>{t("receive_payment")}</Link></Button>}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RetailerBalance({
  retailerId,
  isAdmin,
  userId,
  data,
}: {
  retailerId: string;
  isAdmin: boolean;
  userId: string;
  data: {
    sales: { id: string; retailer_id: string; salesman_id: string; total_amount: number; paid_amount: number }[];
    payments: { id: string; retailer_id: string; salesman_id: string; amount: number }[];
  };
}) {
  const { t } = useLang();
  const sales = data.sales.filter(
    (s) => s.retailer_id === retailerId && (isAdmin || s.salesman_id === userId),
  );
  const payments = data.payments.filter(
    (p) => p.retailer_id === retailerId && (isAdmin || p.salesman_id === userId),
  );
  const balance = Math.max(
    0,
    sales.reduce((a, s) => a + toNumber(s.total_amount) - toNumber(s.paid_amount), 0) -
      payments.reduce((a, p) => a + toNumber(p.amount), 0),
  );
  return (
    <span className="badge-warn justify-self-start whitespace-normal">
      {t("balance")}: {formatBDT(balance)}
    </span>
  );
}
