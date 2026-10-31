/**
 * IMEI rules mirrored by the database functions (issue_imei / sell_imei /
 * return_imei). The client shows green/red signals from this logic; the
 * database re-validates every transition server-side.
 */

export type ImeiStatus = "in_dealer_stock" | "with_salesman" | "sold";

export type ImeiAction = "issue" | "sell" | "return";

/** Allowed transitions per action, mirroring the Postgres functions. */
const ALLOWED: Record<ImeiAction, ImeiStatus[]> = {
  issue: ["in_dealer_stock"],
  sell: ["with_salesman"],
  return: ["with_salesman"],
};

export function normalizeImei(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/** A scanned IMEI must be 14–16 digits (box barcodes vary by manufacturer). */
export function isPlausibleImei(code: string): boolean {
  const digits = normalizeImei(code);
  return digits.length >= 14 && digits.length <= 16;
}

export interface TransitionCheck {
  ok: boolean;
  reason:
    | "unknown_imei"
    | "not_plausible"
    | "wrong_status"
    | "ok";
}

export function checkTransition(
  action: ImeiAction,
  currentStatus: ImeiStatus | null,
): TransitionCheck {
  if (currentStatus === null) return { ok: false, reason: "unknown_imei" };
  if (!ALLOWED[action].includes(currentStatus)) {
    return { ok: false, reason: "wrong_status" };
  }
  return { ok: true, reason: "ok" };
}
