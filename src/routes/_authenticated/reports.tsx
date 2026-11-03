import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileSpreadsheet, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { BusinessPaper } from "@/components/BusinessPaper";
import { ReportShare } from "@/components/ReportShare";
import { fetchAccounting } from "@/lib/accounting";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import {
  buildDocument,
  buildReport,
  displayDate,
  documentTitles,
  reference,
  reportTitles,
  type DocumentKind,
  type ReportKind,
} from "@/lib/reports";
import { createExcelFile, createPdfFile, exportExcel, exportPdf } from "@/lib/report-export";
import { businessDateKey } from "@/lib/business-time";
const reportsQuery = queryOptions({ queryKey: ["business-reports"], queryFn: fetchAccounting });
export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Documents — FE MANAGEMENT" },
      {
        name: "description",
        content:
          "FIROZA ENTERPRISE accounts, Excel exports, PDF invoices, receipts and business stationery.",
      },
      { property: "og:title", content: "Reports & Documents — FE MANAGEMENT" },
      {
        property: "og:description",
        content: "Business reports, invoices, receipts and stock vouchers for FIROZA ENTERPRISE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQuery),
  component: ReportsPage,
});
function ReportsPage() {
  const { data: d } = useSuspenseQuery(reportsQuery),
    { lang } = useLang(),
    role = useMyRole();
  const bn = lang === "bn";
  const [mode, setMode] = useState<"reports" | "documents">("reports");
  const [kind, setKind] = useState<ReportKind>("sales"),
    [docKind, setDocKind] = useState<DocumentKind>("invoice");
  const [selected, setSelected] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sr, setSr] = useState(""),
    [dealer, setDealer] = useState("");
  const [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  const report = buildReport(d, kind, { from, to, sr, dealer });
  const options =
    docKind === "invoice"
      ? d.sales.map((s) => ({
          id: s.id,
          label: `${reference("INV", s.id)} · ${d.retailers.find((r) => r.id === s.retailer_id)?.name || "—"} · ${displayDate(s.sold_at)}`,
        }))
      : docKind === "receipt"
        ? d.payments.map((s) => ({
            id: s.id,
            label: `${reference("MR", s.id)} · ${d.retailers.find((r) => r.id === s.retailer_id)?.name || "—"}`,
          }))
        : docKind === "issue"
          ? d.stockIssues.map((s) => ({
              id: s.id,
              label: `${reference("ISS", s.id)} · ${displayDate(s.issued_at)}`,
            }))
          : docKind === "return"
            ? d.returns.map((s) => ({
                id: s.id,
                label: `${reference("RET", s.id)} · ${displayDate(s.returned_at)}`,
              }))
            : docKind === "settlement"
              ? d.settlements.map((s) => ({
                  id: s.id,
                  label: `${reference("SET", s.id)} · ${displayDate(s.created_at)}`,
                }))
              : docKind === "credit_note"
                ? d.dealerReturns.map((s) => ({
                    id: s.id,
                    label: `${reference("CN", s.id)} · ${displayDate(s.created_at)}`,
                  }))
                : [];
  const doc = buildDocument(d, docKind, selected),
    printable = mode === "reports" ? report : doc;
  const balanceReport = kind === "dealers" || kind === "sr";
  const invalidRange = mode === "reports" && !balanceReport && !!from && !!to && from > to;
  const subtitle =
    mode === "reports"
      ? `${balanceReport ? "Closing balances / সমাপনী হিসাব" : "Period / সময়"}: ${balanceReport ? "Start" : from || "Start"} — ${to || "Today"}${sr ? " · SR: " + (d.profiles.find((p) => p.id === sr)?.full_name || sr) : ""}${dealer ? " · Dealer: " + (d.retailers.find((p) => p.id === dealer)?.name || dealer) : ""}`
      : undefined;
  async function save(format: "excel" | "pdf") {
    if (!printable || invalidRange) return;
    setBusy(true);
    try {
      if (format === "excel")
        await exportExcel(
          printable,
          "FE-" + (mode === "reports" ? kind : doc?.reference || docKind),
        );
      else if (paper.current)
        await exportPdf(
          paper.current,
          "FE-" + (mode === "reports" ? kind : doc?.reference || docKind),
        );
    } catch {
      toast.error(
        bn ? "ফাইল তৈরি হয়নি; আবার চেষ্টা করুন" : "Could not create the file. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const ids = new Set(d.roles.filter((r) => r.role === "salesman").map((r) => r.user_id));
  return (
    <AppShell title={bn ? "রিপোর্ট ও কাগজপত্র" : "Reports & documents"}>
      <div className="print-hidden">
        <h1 className="page-title mb-4">
          {bn ? "রিপোর্ট ও ব্যবসায়িক কাগজপত্র" : "Reports & business documents"}
        </h1>
        <div className="mb-5 flex gap-2" role="tablist">
          <Button
            role="tab"
            aria-selected={mode === "reports"}
            variant={mode === "reports" ? "default" : "outline"}
            onClick={() => setMode("reports")}
          >
            {bn ? "রিপোর্ট" : "Reports"}
          </Button>
          <Button
            role="tab"
            aria-selected={mode === "documents"}
            variant={mode === "documents" ? "default" : "outline"}
            onClick={() => setMode("documents")}
          >
            {bn ? "কাগজপত্র" : "Documents"}
          </Button>
        </div>
        {mode === "reports" ? (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label" htmlFor="report-kind">
                {bn ? "তালিকা" : "Report"}
              </label>
              <select
                id="report-kind"
                className="input"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ReportKind);
                  setDealer("");
                }}
              >
                {Object.entries(reportTitles).map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
            {!balanceReport && kind !== "products" && kind !== "imei" && (
              <div>
                <label className="label" htmlFor="report-from">
                  {bn ? "শুরু" : "From"}
                </label>
                <input
                  id="report-from"
                  className="input"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
            )}
            {kind !== "products" && kind !== "imei" && (
              <div>
                <label className="label" htmlFor="report-to">
                  {balanceReport ? (bn ? "সমাপনী তারিখ" : "As of") : bn ? "শেষ" : "To"}
                </label>
                <input
                  id="report-to"
                  className="input"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            )}
            {role.data?.isAdmin && kind !== "products" && (
              <div>
                <label className="label" htmlFor="report-sr">
                  SR
                </label>
                <select
                  id="report-sr"
                  className="input"
                  value={sr}
                  onChange={(e) => setSr(e.target.value)}
                >
                  <option value="">{bn ? "সকল SR" : "All SRs"}</option>
                  {d.profiles
                    .filter((p) => ids.has(p.id))
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {["sales", "payments", "dealers", "ledger", "credit_notes"].includes(kind) && (
              <div>
                <label className="label" htmlFor="report-dealer">
                  {bn ? "ডিলার" : "Dealer"}
                </label>
                <select
                  id="report-dealer"
                  className="input"
                  value={dealer}
                  onChange={(e) => setDealer(e.target.value)}
                >
                  <option value="">{bn ? "সকল ডিলার" : "All dealers"}</option>
                  {d.retailers.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 grid gap-3">
            <div>
              <label htmlFor="document-kind" className="label">
                {bn ? "কাগজপত্রের ধরন" : "Document type"}
              </label>
              <select
                id="document-kind"
                className="input"
                value={docKind}
                onChange={(e) => {
                  setDocKind(e.target.value as DocumentKind);
                  setSelected("");
                }}
              >
                {Object.entries(documentTitles).map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
            {docKind !== "letterhead" ? (
              <div>
                <label htmlFor="document-record" className="label">
                  {bn ? "লেনদেন" : "Transaction"}
                </label>
                <select
                  id="document-record"
                  className="input"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <input
                  aria-label="Recipient"
                  placeholder={bn ? "প্রাপক" : "Recipient"}
                  className="input"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <input
                  aria-label="Subject"
                  placeholder={bn ? "বিষয়" : "Subject"}
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <textarea
                  aria-label="Letter body"
                  placeholder={bn ? "বিবরণ" : "Letter body"}
                  className="input min-h-40"
                  maxLength={1800}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </>
            )}
          </div>
        )}
        {invalidRange && (
          <p role="alert" className="mb-3 text-destructive">
            {bn ? "শেষ তারিখ শুরুর তারিখের পরে দিন" : "End date must not precede start date"}
          </p>
        )}
        <div className="mb-5 flex flex-wrap gap-2">
          {docKind !== "letterhead" || mode === "reports" ? (
            <Button
              variant="outline"
              disabled={!printable || busy || invalidRange}
              onClick={() => void save("excel")}
            >
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!printable || busy || invalidRange}
            onClick={() => void save("pdf")}
          >
            <FileDown className="size-4" />
            PDF
          </Button>
          <Button
            variant="outline"
            disabled={!printable || busy || invalidRange}
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
            {bn ? "প্রিন্ট" : "Print"}
          </Button>
          <ReportShare
            key={`${mode}-${kind}-${docKind}-${selected}-${from}-${to}-${sr}-${dealer}-${subject}-${body}-${recipient}`}
            bn={bn}
            disabled={!printable || busy || invalidRange}
            title={printable?.title || ""}
            allowExcel={mode === "reports" || docKind !== "letterhead"}
            prepare={async (format) => {
              if (!printable || invalidRange) throw new Error("Select a valid document");
              const filename = "FE-" + (mode === "reports" ? kind : doc?.reference || docKind);
              if (format === "excel") return createExcelFile(printable, filename);
              if (!paper.current) throw new Error("Document is not ready");
              return createPdfFile(paper.current, filename);
            }}
          />
          {busy && (
            <span role="status" className="text-sm text-muted-foreground">
              {bn ? "ফাইল তৈরি হচ্ছে…" : "Preparing file…"}
            </span>
          )}
        </div>
      </div>
      {printable ? (
        <div className="paper-scroll">
          <div ref={paper} className="business-paper">
            <BusinessPaper
              report={printable}
              document={mode === "documents" && doc ? doc : undefined}
              subtitle={subtitle}
              letter={
                mode === "documents" && docKind === "letterhead"
                  ? { subject, body, recipient, date: businessDateKey(new Date()) }
                  : undefined
              }
            />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {bn ? "লেনদেন নির্বাচন করুন" : "Select a transaction"}
        </p>
      )}
    </AppShell>
  );
}
