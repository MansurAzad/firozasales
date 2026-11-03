import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { useServerFn } from "@tanstack/react-start";
import { createSalesmanAccount, listSalesmanAccounts } from "@/lib/admin.functions";
import { SrPasswordReset } from "@/components/SrPasswordReset";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cachedRead } from "@/lib/offline";
import { onlineRequired } from "@/lib/offline-store";
import { Pencil } from "lucide-react";
import { displayBusinessDate } from "@/lib/business-time";

export const Route = createFileRoute("/_authenticated/salesmen")({
  head: () => ({
    meta: [
      { title: "Salesman — FE MANAGEMENT" },
      { name: "description", content: "Create and manage salesman accounts." },
      { property: "og:title", content: "Salesman — FE MANAGEMENT" },
      { property: "og:description", content: "Create and manage salesman accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesmenPage,
});

function SalesmenPage() {
  const { t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listSalesmanAccounts);

  const list = useQuery({
    queryKey: ["salesmen-list"],
    queryFn: () => cachedRead("sr-accounts", () => listFn()),
    enabled: role.data?.isAdmin === true && role.data.isActive,
  });

  if (role.isLoading) {
    return (
      <AppShell title={t("salesmen_title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </AppShell>
    );
  }
  if (!role.data?.isAdmin) {
    return (
      <AppShell title={t("salesmen_title")}>
        <div className="card">
          <p className="text-sm text-muted-foreground">{t("no_access")}</p>
        </div>
      </AppShell>
    );
  }

  if (list.error) throw list.error;
  return (
    <AppShell title={t("salesmen_title")}>
      <h1 className="page-title mb-4">{t("salesmen_title")}</h1>
      <AddSalesman onDone={() => queryClient.invalidateQueries({ queryKey: ["salesmen-list"] })} />
      <SalesmanList
        rows={list.data}
        onChange={() => queryClient.invalidateQueries({ queryKey: ["salesmen-list"] })}
      />
    </AppShell>
  );
}

function AddSalesman({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const createFn = useServerFn(createSalesmanAccount);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: (input: { email: string; password: string; fullName: string }) => {
      onlineRequired();
      return createFn({ data: input });
    },
    onSuccess: () => {
      toast.success(t("account_created"));
      setFullName("");
      setEmail("");
      setPassword("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button type="button" className="btn-primary mb-4" onClick={() => setOpen(true)}>
        + {t("add_salesman")}
      </Button>
    );
  }

  return (
    <div className="card mb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ email, password, fullName });
        }}
      >
        <div className="field">
          <label className="label" htmlFor="sm-name">
            {t("fullName")}
          </label>
          <input
            id="sm-name"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="sm-email">
            {t("email")}
          </label>
          <input
            id="sm-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="sm-pass">
            {t("password")}
          </label>
          <input
            id="sm-pass"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder={t("password_hint")}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="btn-primary" disabled={create.isPending}>
            {t("create_account")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="btn-outline"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SalesmanList({
  rows,
  onChange,
}: {
  rows:
    | { id: string; email: string; full_name: string; is_active: boolean; created_at: string }[]
    | undefined;
  onChange: () => void;
}) {
  const { t } = useLang();

  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const rename = useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      onlineRequired();
      const { error } = await supabase.rpc("set_sr_name", {
        p_user_id: input.id,
        p_full_name: input.name.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(null);
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: async (row: { id: string; is_active: boolean }) => {
      onlineRequired();
      const { error } = await supabase.rpc("set_sr_active", {
        p_user_id: row.id,
        p_active: !row.is_active,
      });
      if (error) throw error;
    },
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  if (!rows) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("noData")}</p>;

  return (
    <div className="card">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid min-w-0 gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div>
            {editing?.id === row.id && (
              <form
                className="mb-2 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate(editing);
                }}
              >
                <input
                  aria-label={t("fullName")}
                  className="input min-w-0 flex-1"
                  required
                  maxLength={120}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <Button type="submit" disabled={rename.isPending || !editing.name.trim()}>
                  {t("save")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
              </form>
            )}
            <div className="font-semibold text-foreground">{row.full_name || "—"}</div>
            <div className="break-all text-sm text-muted-foreground">{row.email}</div>
            <div className="text-xs text-muted-foreground">
              {displayBusinessDate(row.created_at)}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("edit")}
              title={t("edit")}
              onClick={() => setEditing({ id: row.id, name: row.full_name })}
            >
              <Pencil />
            </Button>
            <SrPasswordReset userId={row.id} name={row.full_name} email={row.email} />
            <span className={row.is_active ? "badge-ok" : "badge-warn"}>
              {row.is_active ? t("active") : t("inactive")}
            </span>
            <Button
              variant="outline"
              disabled={toggle.isPending}
              type="button"
              className="btn-outline btn-sm"
              onClick={() => toggle.mutate(row)}
            >
              {row.is_active ? t("deactivate") : t("activate")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
