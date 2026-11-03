import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/i18n";
import { fetchAccounting } from "@/lib/accounting";
import { displayBusinessDate } from "@/lib/business-time";
import { reference } from "@/lib/reports";
import { useMyRole } from "@/lib/role";
import { isOffline } from "@/lib/offline-store";

type ReversalKind =
  "sale" | "payment" | "issue" | "settlement" | "inventory_receipt" | "dealer_return";

interface ReversalCandidate {
  id: string;
  kind: ReversalKind;
  at: string;
  label: string;
}

export const Route = createFileRoute("/_authenticated/transaction-reversals")({
  head: () => ({
    meta: [
      { title: "Transaction reversals — FE MANAGEMENT" },
      { name: "description", content: "Admin-only audited financial and stock corrections." },
    ],
  }),
  component: TransactionReversalsPage,
});

function TransactionReversalsPage() {
  const { lang, t } = useLang();
  const role = useMyRole();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState("");
  const [reason, setReason] = useState("");
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const query = useQuery({
    queryKey: ["transaction-reversals"],
    queryFn: fetchAccounting,
    enabled: role.data?.isAdmin === true,
  });
  const data = query.data;
  const candidates: ReversalCandidate[] = data
    ? [
        ...data.sales.map((row) => ({
          id: row.id,
          kind: "sale" as const,
          at: row.sold_at,
          label: `${reference("INV", row.id)} · ${displayBusinessDate(row.sold_at)}`,
        })),
        ...data.payments.map((row) => ({
          id: row.id,
          kind: "payment" as const,
          at: row.paid_at,
          label: `${reference("MR", row.id)} · ${displayBusinessDate(row.paid_at)}`,
        })),
        ...data.stockIssues.map((row) => ({
          id: row.id,
          kind: "issue" as const,
          at: row.issued_at,
          label: `${reference("ISS", row.id)} · ${displayBusinessDate(row.issued_at)}`,
        })),
        ...data.settlements.map((row) => ({
          id: row.id,
          kind: "settlement" as const,
          at: row.created_at,
          label: `${reference("SET", row.id)} · ${displayBusinessDate(row.created_at)}`,
        })),
        ...data.inventoryReceipts.map((row) => ({
          id: row.id,
          kind: "inventory_receipt" as const,
          at: row.received_at,
          label: `${reference("RCV", row.id)} · ${displayBusinessDate(row.received_at)}`,
        })),
        ...data.dealerReturns.map((row) => ({
          id: row.id,
          kind: "dealer_return" as const,
          at: row.created_at,
          label: `${reference("CN", row.id)} · ${displayBusinessDate(row.created_at)}`,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at))
    : [];
  const selected = candidates.find(
    (candidate) => `${candidate.kind}:${candidate.id}` === selection,
  );
  const reverse = useMutation({
    mutationFn: async () => {
      if (!selected)
        throw new Error(lang === "bn" ? "লেনদেন নির্বাচন করুন" : "Select a transaction");
      if (isOffline())
        throw new Error(
          lang === "bn"
            ? "লেনদেন বাতিল অনলাইনে করতে হবে"
            : "Reversals require an internet connection",
        );
      if (reason.trim().length < 8 || reason.trim().length > 500) {
        throw new Error(
          lang === "bn"
            ? "কারণ ৮–৫০০ অক্ষরের মধ্যে দিন"
            : "Enter a reason between 8 and 500 characters",
        );
      }
      if (!physicalConfirmed) {
        throw new Error(
          lang === "bn"
            ? "পণ্য ও নগদ চলাচল শারীরিকভাবে যাচাই নিশ্চিত করুন"
            : "Confirm that the physical stock and cash movements were verified",
        );
      }
      const signature = JSON.stringify([
        selected.kind,
        selected.id,
        reason.trim(),
        physicalConfirmed,
      ]);
      if (request.current?.signature !== signature) {
        request.current = { signature, id: crypto.randomUUID() };
      }
      const { data: result, error } = await supabase.rpc("reverse_transaction", {
        p_kind: selected.kind,
        p_transaction_id: selected.id,
        p_reason: reason.trim(),
        p_physical_confirmed: physicalConfirmed,
        p_request_id: request.current.id,
      });
      if (error) throw new Error(error.message);
      return result;
    },
    onSuccess: () => {
      toast.success(
        lang === "bn"
          ? "লেনদেন বাতিল করে অডিটে সংরক্ষণ করা হয়েছে"
          : "Transaction reversed and recorded in the audit log",
      );
      request.current = null;
      setSelection("");
      setReason("");
      setPhysicalConfirmed(false);
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!role.data?.isAdmin) {
    return (
      <AppShell title={t("nav_reversals")}>
        <p className="text-sm text-muted-foreground">
          {role.isLoading
            ? t("loading")
            : lang === "bn"
              ? "শুধু Admin এই পেজ ব্যবহার করতে পারবেন"
              : "Only an Admin can use this page"}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("nav_reversals")}>
      <h1 className="page-title mb-2">
        {lang === "bn" ? "লেনদেন সংশোধন / বাতিল" : "Transaction reversal"}
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {lang === "bn"
          ? "মূল রেকর্ড মুছে যাবে না। কারণ ও যাচাইকৃত স্টক/নগদ অবস্থানসহ অডিট রেকর্ড তৈরি হবে। পরবর্তী নির্ভরশীল লেনদেন থাকলে সার্ভার বাতিল প্রত্যাখ্যান করবে।"
          : "Original records remain unchanged. Each reversal is permanently audited with a reason and stock/cash confirmation. The server rejects reversals with active downstream activity."}
      </p>

      <section className="card mb-4">
        <label className="mb-3 block">
          <span className="label">{lang === "bn" ? "লেনদেন নির্বাচন" : "Transaction"}</span>
          <select
            className="input"
            value={selection}
            onChange={(event) => {
              setSelection(event.target.value);
              setPhysicalConfirmed(false);
            }}
          >
            <option value="">—</option>
            {candidates.map((candidate) => (
              <option
                key={`${candidate.kind}:${candidate.id}`}
                value={`${candidate.kind}:${candidate.id}`}
              >
                {candidate.kind.replaceAll("_", " ")} · {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3 block">
          <span className="label">
            {lang === "bn" ? "বাতিলের কারণ (৮–৫০০ অক্ষর)" : "Reason (8–500 characters)"}
          </span>
          <textarea
            className="input min-h-24"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={physicalConfirmed}
            onChange={(event) => setPhysicalConfirmed(event.target.checked)}
          />
          <span>
            {lang === "bn"
              ? "পণ্য ও প্রযোজ্য নগদ চলাচল শারীরিকভাবে যাচাই করেছি।"
              : "I physically verified the stock and any related cash movement."}
          </span>
        </label>
        <Button
          className="w-full"
          disabled={
            query.isLoading ||
            reverse.isPending ||
            !selected ||
            reason.trim().length < 8 ||
            reason.trim().length > 500 ||
            !physicalConfirmed
          }
          onClick={() => reverse.mutate()}
        >
          {reverse.isPending
            ? t("loading")
            : lang === "bn"
              ? "লেনদেন বাতিল করুন"
              : "Reverse transaction"}
        </Button>
      </section>

      <section className="card">
        <h2 className="card-title mb-3">
          {lang === "bn" ? "বাতিলের অডিট ইতিহাস" : "Reversal audit history"}
        </h2>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : query.error ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : (data?.transactionReversals ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          (data?.transactionReversals ?? []).map((entry) => (
            <div className="row" key={entry.id}>
              <div className="min-w-0">
                <p className="font-medium">
                  {entry.transaction_kind.replaceAll("_", " ")} ·{" "}
                  {reference("REV", entry.transaction_id)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {displayBusinessDate(entry.created_at)} ·{" "}
                  {data?.profiles.find((profile) => profile.id === entry.reversed_by)?.full_name ??
                    "—"}
                </p>
                <p className="text-sm">{entry.reason}</p>
              </div>
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}
