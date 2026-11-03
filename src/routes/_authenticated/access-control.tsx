import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ShieldCheck, Search, Pencil, RefreshCw, Users, History, Check, Minus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { isOffline, onlineRequired } from "@/lib/offline-store";
import {
  accessChangeBlock,
  accessReasonSchema,
  accessRules,
  accessSnapshotSchema,
  type AccessUser,
} from "@/lib/access-control";
import { displayBusinessDate } from "@/lib/business-time";

export const Route = createFileRoute("/_authenticated/access-control")({
  head: () => ({
    meta: [
      { title: "User Roles & Access — FE MANAGEMENT" },
      {
        name: "description",
        content: "FIROZA ENTERPRISE administrator user roles, access controls and change history.",
      },
      { property: "og:title", content: "User Roles & Access — FE MANAGEMENT" },
      {
        property: "og:description",
        content:
          "Manage FIROZA ENTERPRISE staff access with protected administrator controls and audit history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccessPage,
});
function AccessPage() {
  const { lang, t } = useLang(),
    role = useMyRole(),
    client = useQueryClient();
  const l = (bn: string, en: string) => (lang === "bn" ? bn : en);
  const [offline, setOffline] = useState(isOffline()),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<"users" | "rules" | "history">("users"),
    [page, setPage] = useState(0);
  const [editing, setEditing] = useState<AccessUser>(),
    [nextRole, setNextRole] = useState<AccessUser["role"]>("salesman"),
    [active, setActive] = useState(true),
    [reason, setReason] = useState("");
  useEffect(() => {
    const update = () => setOffline(isOffline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const allowed = role.data?.isAdmin === true && role.data.isActive && !offline;
  const users = useQuery({
    queryKey: ["access-users", role.data?.userId],
    enabled: allowed,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      onlineRequired();
      const { data, error } = await supabase.rpc("access_control_snapshot");
      if (error) throw error;
      return accessSnapshotSchema.parse(data).users;
    },
  });
  const history = useQuery({
    queryKey: ["access-history", role.data?.userId, page],
    enabled: allowed && tab === "history",
    staleTime: 0,
    queryFn: async () => {
      onlineRequired();
      const { data, error, count } = await supabase
        .from("access_audit")
        .select("*", { count: "exact" })
        .order("changed_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      onlineRequired();
      if (!editing || !role.data) throw new Error("User unavailable");
      if (accessChangeBlock(role.data.userId, editing, users.data ?? [], nextRole, active))
        throw new Error(l("এই পরিবর্তন অনুমোদিত নয়", "This change is not allowed"));
      const parsed = accessReasonSchema.safeParse(reason);
      if (!parsed.success)
        throw new Error(l("৩–৫০০ অক্ষরে কারণ লিখুন", "Enter a reason of 3–500 characters"));
      const { data, error } = await supabase.rpc("manage_user_access", {
        p_user_id: editing.id,
        p_role: nextRole,
        p_active: active,
        p_expected_role: editing.role,
        p_expected_active: editing.is_active,
        p_reason: parsed.data,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (changed) => {
      setEditing(undefined);
      await client.invalidateQueries();
      toast.success(
        changed
          ? l("প্রবেশাধিকার আপডেট হয়েছে", "Access updated")
          : l("কোনো পরিবর্তন হয়নি", "No changes needed"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (users.data ?? []).filter(
    (u) =>
      (u.full_name.toLowerCase().includes(search.toLowerCase()) || u.id.includes(search)) &&
      (filter === "all" ||
        filter === u.role ||
        (filter === "active" && u.is_active) ||
        (filter === "inactive" && !u.is_active)),
  );
  const names = new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.id]));
  const block = editing
    ? accessChangeBlock(role.data?.userId ?? "", editing, users.data ?? [], nextRole, active)
    : undefined;
  return (
    <AppShell title={t("nav_access")}>
      <div className="mb-5 flex items-center justify-between gap-2">
        <h1 className="page-title flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-6 w-6 shrink-0" />
          {l("ভূমিকা ও প্রবেশাধিকার", "User roles & access")}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={l("রিফ্রেশ", "Refresh access")}
          title={l("রিফ্রেশ", "Refresh access")}
          disabled={!allowed || users.isFetching}
          onClick={() => void client.invalidateQueries()}
        >
          <RefreshCw />
        </Button>
      </div>
      {role.isLoading ? (
        <p>{t("loading")}</p>
      ) : !role.data?.isAdmin ? (
        <p role="alert" className="text-destructive">
          {t("no_access")}
        </p>
      ) : offline ? (
        <p role="alert" className="text-destructive">
          {l(
            "প্রবেশাধিকার দেখা ও বদলাতে ইন্টারনেট প্রয়োজন।",
            "Access management requires an internet connection.",
          )}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 border-y border-border py-4 text-center">
            <div>
              <strong className="text-2xl">{users.data?.length ?? "—"}</strong>
              <p className="text-xs text-muted-foreground">{l("ব্যবহারকারী", "Users")}</p>
            </div>
            <div>
              <strong className="text-2xl text-primary">
                {users.data?.filter((u) => u.role === "admin" && u.is_active).length ?? "—"}
              </strong>
              <p className="text-xs text-muted-foreground">{l("চালু অ্যাডমিন", "Active admins")}</p>
            </div>
            <div>
              <strong className="text-2xl">
                {users.data?.filter((u) => u.role === "salesman" && u.is_active).length ?? "—"}
              </strong>
              <p className="text-xs text-muted-foreground">{l("চালু SR", "Active SRs")}</p>
            </div>
          </div>
          <div
            className="my-4 flex flex-wrap gap-2"
            role="tablist"
            aria-label={l("প্রবেশাধিকার বিভাগ", "Access views")}
          >
            <Button
              role="tab"
              aria-selected={tab === "users"}
              variant={tab === "users" ? "default" : "outline"}
              onClick={() => setTab("users")}
            >
              <Users />
              {l("ব্যবহারকারী", "Users")}
            </Button>
            <Button
              role="tab"
              aria-selected={tab === "rules"}
              variant={tab === "rules" ? "default" : "outline"}
              onClick={() => setTab("rules")}
            >
              <ShieldCheck />
              {l("অনুমতির তালিকা", "Permissions")}
            </Button>
            <Button
              role="tab"
              aria-selected={tab === "history"}
              variant={tab === "history" ? "default" : "outline"}
              onClick={() => setTab("history")}
            >
              <History />
              {l("ইতিহাস", "History")}
            </Button>
          </div>
          {users.error && (
            <p role="alert" className="text-destructive">
              {users.error.message}
            </p>
          )}
          {tab === "users" && (
            <section className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    aria-label={l("ব্যবহারকারী খুঁজুন", "Search users")}
                    className="input pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={l("নাম বা পরিচয়", "Name or user ID")}
                  />
                </label>
                <select
                  className="input w-auto"
                  aria-label={l("ব্যবহারকারী ফিল্টার", "Filter users")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">{l("সবাই", "All users")}</option>
                  <option value="admin">Admin</option>
                  <option value="salesman">SR</option>
                  <option value="active">{t("active")}</option>
                  <option value="inactive">{t("inactive")}</option>
                </select>
              </div>
              {users.isLoading ? (
                <p>{t("loading")}</p>
              ) : !rows.length ? (
                <p>{t("noData")}</p>
              ) : (
                rows.map((u) => (
                  <article
                    key={u.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold break-words">{u.full_name || "—"}</h2>
                        <span className="badge-mut">{u.role === "admin" ? "Admin" : "SR"}</span>
                        <span className={u.is_active ? "badge-ok" : "badge-warn"}>
                          {u.is_active ? t("active") : t("inactive")}
                        </span>
                        {u.id === role.data?.userId && (
                          <span className="text-xs text-muted-foreground">{l("আপনি", "You")}</span>
                        )}
                      </div>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{u.id}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`${l("প্রবেশাধিকার সম্পাদনা", "Edit access")}: ${u.full_name}`}
                      title={l("প্রবেশাধিকার সম্পাদনা", "Edit access")}
                      disabled={u.id === role.data?.userId}
                      onClick={() => {
                        setEditing(u);
                        setNextRole(u.role);
                        setActive(u.is_active);
                        setReason("");
                      }}
                    >
                      <Pencil />
                    </Button>
                  </article>
                ))
              )}
              <Button asChild variant="outline">
                <Link to="/salesmen">
                  <Users />
                  {l("SR তৈরি ও পাসওয়ার্ড", "SR creation & passwords")}
                </Link>
              </Button>
            </section>
          )}
          {tab === "rules" && (
            <section>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-3 text-left">{l("অনুমতি", "Permission")}</th>
                      <th className="p-3">Admin</th>
                      <th className="p-3">SR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessRules.map((r) => (
                      <tr key={r.en} className="border-b border-border">
                        <td className="py-3">{lang === "bn" ? r.bn : r.en}</td>
                        {[r.admin, r.sr].map((scope, i) => (
                          <td key={i} className="p-3 text-center">
                            {scope === "none" ? (
                              <Minus
                                className="mx-auto h-4 w-4 text-muted-foreground"
                                aria-label={l("অনুমতি নেই", "Not allowed")}
                              />
                            ) : scope === "own" ? (
                              l("নিজের হিসাব", "Own accounts")
                            ) : scope === "read" ? (
                              l("দেখা", "Read")
                            ) : (
                              <Check
                                className="mx-auto h-4 w-4 text-primary"
                                aria-label={l("অনুমোদিত", "Allowed")}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {l(
                  "বন্ধ অ্যাকাউন্ট অনলাইনে হিসাব ব্যবহার করতে পারবে না। অফলাইনের পুরোনো সংরক্ষণ দূর থেকে মুছতে পারা যায় না; পুনরায় অনলাইনে যাচাইয়ে নতুন অনুমতি কার্যকর হবে।",
                  "Inactive accounts cannot use online accounts. Previously saved offline data cannot be remotely erased; current access is checked again when reconnecting.",
                )}
              </p>
            </section>
          )}
          {tab === "history" && (
            <section>
              {history.isLoading ? (
                <p>{t("loading")}</p>
              ) : history.error ? (
                <p role="alert" className="text-destructive">
                  {history.error.message}
                </p>
              ) : !history.data?.rows.length ? (
                <p>
                  {l("এখনও প্রবেশাধিকার পরিবর্তনের ইতিহাস নেই।", "No access changes recorded yet.")}
                </p>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {history.data.rows.map((h) => (
                      <article className="py-4 space-y-1" key={h.id}>
                        <h2 className="font-semibold break-words">
                          {names.get(h.target_id) ?? h.target_id}
                        </h2>
                        <p className="text-sm">
                          {h.old_role === "admin" ? "Admin" : "SR"} /{" "}
                          {h.old_active ? t("active") : t("inactive")} →{" "}
                          {h.new_role === "admin" ? "Admin" : "SR"} /{" "}
                          {h.new_active ? t("active") : t("inactive")}
                        </p>
                        <p className="break-words text-sm">{h.reason}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {names.get(h.actor_id) ?? h.actor_id} ·{" "}
                          {displayBusinessDate(h.changed_at, lang === "bn" ? "bn-BD" : "en-GB")}
                        </p>
                      </article>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  disabled={page === 0 || history.isFetching}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {l("আগের", "Previous")}
                </Button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil((history.data?.count ?? 0) / 20))}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    !history.data || (page + 1) * 20 >= history.data.count || history.isFetching
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  {l("পরের", "Next")}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
      <Dialog
        open={!!editing && allowed}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>{l("প্রবেশাধিকার সম্পাদনা", "Edit access")}</DialogTitle>
          <DialogDescription className="break-words">
            {editing?.full_name} ·{" "}
            {l(
              "নিজের অধিকার বা শেষ চালু অ্যাডমিন বন্ধ করা যাবে না। SR-এর লেনদেন থাকলে তাকে অ্যাডমিন করা যাবে না।",
              "Your own access and the last active admin are protected. An SR with transaction history cannot be promoted to admin.",
            )}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <label className="block">
              <span className="label">{l("ভূমিকা", "Role")}</span>
              <select
                className="input"
                value={nextRole}
                onChange={(e) => setNextRole(e.target.value === "admin" ? "admin" : "salesman")}
              >
                <option value="salesman">SR</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              {l("অ্যাকাউন্ট চালু", "Account active")}
            </label>
            <label className="block">
              <span className="label">{l("পরিবর্তনের কারণ", "Reason for change")}</span>
              <textarea
                className="input min-h-20"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
              />
            </label>
            {block && (
              <p role="alert" className="text-destructive">
                {block === "self"
                  ? l("নিজের প্রবেশাধিকার বদলানো যাবে না।", "You cannot change your own access.")
                  : l(
                      "অন্তত একজন চালু অ্যাডমিন রাখতে হবে।",
                      "At least one active admin must remain.",
                    )}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={save.isPending}
                onClick={() => setEditing(undefined)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending || !!block || !accessReasonSchema.safeParse(reason).success
                }
              >
                {save.isPending ? t("loading") : l("নিশ্চিত করে সেভ", "Confirm & save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
