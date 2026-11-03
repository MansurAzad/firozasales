import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { AccountingSnapshot } from "./accounting";
import type { LocalAccount } from "./offline-store";

const id = z.string().uuid(),
  text = z.string(),
  date = z.string();
const money = z.number().finite().nonnegative(),
  qty = z.number().int().positive();
const nullableId = id.nullable();
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const snapshotSchema = z.object({
  profiles: z.array(z.object({ id, full_name: text, is_active: z.boolean(), created_at: date })),
  roles: z.array(z.object({ id, user_id: id, role: z.enum(["admin", "salesman"]) })),
  products: z.array(
    z.object({
      id,
      name: text,
      model: text,
      price: money,
      category: z.enum(["smartphone", "button_phone"]),
      is_active: z.boolean(),
      created_at: date,
    }),
  ),
  retailers: z.array(
    z.object({
      id,
      name: text,
      phone: text,
      address: text,
      is_active: z.boolean(),
      created_at: date,
    }),
  ),
  imeiUnits: z.array(
    z.object({
      id,
      product_id: id,
      imei: text,
      status: z.enum(["in_dealer_stock", "with_salesman", "sold"]),
      current_salesman: nullableId,
      issued_at: date.nullable(),
      sold_at: date.nullable(),
      returned_at: date.nullable(),
      created_at: date,
      is_damaged: z.boolean(),
      is_voided: z.boolean().default(false),
      receipt_item_id: nullableId.optional().default(null),
    }),
  ),
  sales: z.array(
    z.object({
      id,
      retailer_id: id,
      salesman_id: id,
      total_amount: money,
      paid_amount: money,
      sold_at: date,
      note: text,
    }),
  ),
  saleItems: z.array(
    z.object({
      id,
      sale_id: id,
      product_id: id,
      quantity: qty,
      unit_price: money,
      imei_unit_id: nullableId,
    }),
  ),
  payments: z.array(
    z.object({ id, retailer_id: id, salesman_id: id, amount: money, paid_at: date, note: text }),
  ),
  deposits: z.array(
    z.object({
      id,
      settlement_id: nullableId,
      salesman_id: id,
      amount: money,
      deposited_at: date,
      note: text,
    }),
  ),
  returns: z.array(
    z.object({
      id,
      settlement_id: nullableId,
      salesman_id: id,
      product_id: id,
      quantity: qty,
      imei_unit_id: nullableId,
      is_damaged: z.boolean(),
      returned_at: date,
    }),
  ),
  stockIssues: z.array(
    z.object({ id, salesman_id: id, issued_by: id, issued_at: date, note: text }),
  ),
  issueItems: z.array(
    z.object({ id, issue_id: id, product_id: id, quantity: qty, imei_unit_id: nullableId }),
  ),
  settlements: z.array(z.object({ id, salesman_id: id, created_at: date, note: text })),
  inventoryReceipts: z
    .array(
      z.object({
        id,
        received_by: id,
        source: z.enum(["purchase", "opening"]),
        supplier: text,
        note: text,
        received_at: date,
      }),
    )
    .default([]),
  inventoryReceiptItems: z
    .array(
      z.object({
        id,
        receipt_id: id,
        product_id: id,
        quantity: qty,
        unit_cost: money,
        created_at: date,
      }),
    )
    .default([]),
  dealerReturns: z
    .array(
      z.object({
        id,
        sale_id: id,
        retailer_id: id,
        salesman_id: id,
        created_by: id,
        total_amount: money,
        refund_amount: money,
        credit_amount: money,
        note: text,
        created_at: date,
      }),
    )
    .default([]),
  dealerReturnItems: z
    .array(
      z.object({
        id,
        dealer_return_id: id,
        sale_item_id: id,
        product_id: id,
        quantity: qty,
        unit_price: money,
        imei_unit_id: nullableId,
        is_damaged: z.boolean(),
        created_at: date,
      }),
    )
    .default([]),
  transactionReversals: z
    .array(
      z.object({
        id,
        transaction_kind: z.enum([
          "issue",
          "sale",
          "payment",
          "settlement",
          "inventory_receipt",
          "dealer_return",
        ]),
        transaction_id: id,
        request_id: id,
        reversed_by: id,
        reason: z.string().min(8).max(500),
        source_snapshot: jsonValue,
        created_at: date,
      }),
    )
    .default([]),
});
const backupSchema = z.object({
  format: z.literal("fe-device-backup"),
  version: z.literal(1),
  project: text,
  accountId: id,
  createdAt: text,
  snapshot: snapshotSchema,
  pending: z.array(z.unknown()),
});
export const backupLimit = 25 * 1024 * 1024;
export function createDeviceBackup(account: LocalAccount, project: string) {
  if (!account.snapshot) throw new Error("No saved accounts / সংরক্ষিত হিসাব নেই");
  // No session, credentials, cached authority or auth-email cache is exported.
  return JSON.stringify(
    {
      format: "fe-device-backup",
      version: 1,
      project,
      accountId: account.role.userId,
      createdAt: new Date().toISOString(),
      snapshot: account.snapshot,
      pending: account.entries,
    },
    null,
    2,
  );
}
export function parseDeviceBackup(
  source: string,
  accountId: string,
  project: string,
): { snapshot: AccountingSnapshot; createdAt: string } {
  if (new TextEncoder().encode(source).byteLength > backupLimit)
    throw new Error("Backup exceeds 25 MB");
  const result = backupSchema.safeParse(JSON.parse(source));
  if (!result.success) throw new Error("Invalid backup / ব্যাকআপটি সঠিক নয়");
  const file = result.data;
  if (file.accountId !== accountId || file.project !== project)
    throw new Error("Different account or app / অন্য অ্যাকাউন্ট বা অ্যাপের ব্যাকআপ");
  if (file.pending.length)
    throw new Error(
      "Unverified entries cannot be restored automatically / যাচাই বাকি এন্ট্রি স্বয়ংক্রিয় রিস্টোর করা যাবে না",
    );
  return { snapshot: file.snapshot, createdAt: file.createdAt };
}
export function assertDeviceReplace(account: LocalAccount | undefined) {
  if (account?.entries.length)
    throw new Error("Synchronize pending entries first / আগে বাকি এন্ট্রি মিলিয়ে নিন");
}
