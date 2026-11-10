/** Money is shown with the ৳ sign and English (western) digits: ৳12,500. */
export function formatBDT(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? "-" : "";
  return `${sign}৳${Math.abs(Math.round(safe)).toLocaleString("en-US")}`;
}

export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/** Due for a sale: total charged minus cash actually received. Never negative. */
export function saleDue(total: number, paid: number): number {
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}


/**
 * Cash physically held by an SR after cash deposits and cash refunds.
 * Dealer-return credit notes are not cash refunds and must not be deducted here.
 */
export function expectedCashOnHand(
  cashCollected: number,
  deposited: number,
  cashRefunds: number,
): number {
  return Math.round((cashCollected - deposited - cashRefunds) * 100) / 100;
}
