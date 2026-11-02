import { z } from 'zod';
export const accessUserSchema = z.object({ id: z.string().uuid(), full_name: z.string(), role: z.enum(['admin', 'salesman']), is_active: z.boolean(), created_at: z.string() });
export const accessSnapshotSchema = z.object({ users: z.array(accessUserSchema) });
export type AccessUser = z.infer<typeof accessUserSchema>;
export function accessChangeBlock(actorId: string, target: AccessUser, users: AccessUser[], role: AccessUser['role'], active: boolean) {
  if (role === target.role && active === target.is_active) return undefined;
  if (actorId === target.id) return 'self';
  if (target.role === 'admin' && target.is_active && (role !== 'admin' || !active) && !users.some(u => u.id !== target.id && u.role === 'admin' && u.is_active)) return 'last-admin';
  return undefined;
}
export const accessReasonSchema = z.string().trim().min(3).max(500);
// Existing enforced role scopes, not editable cosmetic permission switches.
export const accessRules = [
  { bn: 'পণ্য ও ডিলার তৈরি/সম্পাদনা', en: 'Create / edit products & dealers', admin: 'all', sr: 'read' },
  { bn: 'SR ও প্রবেশাধিকার পরিচালনা', en: 'Manage SRs & user access', admin: 'all', sr: 'none' },
  { bn: 'মাল ইস্যু', en: 'Issue stock', admin: 'all', sr: 'none' },
  { bn: 'বিক্রি, আদায়, জমা ও ফেরত', en: 'Sales, collections, deposits & returns', admin: 'all', sr: 'own' },
  { bn: 'হিসাব ও রিপোর্ট', en: 'Accounts & reports', admin: 'all', sr: 'own' },
  { bn: 'পোস্ট করা হিসাব বদলানো/মুছা', en: 'Edit / delete posted accounts', admin: 'none', sr: 'none' },
  { bn: 'ভূমিকা পরিবর্তনের ইতিহাস', en: 'Access change history', admin: 'read', sr: 'none' },
] as const;