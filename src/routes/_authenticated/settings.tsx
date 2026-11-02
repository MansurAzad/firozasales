import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, Upload, Trash2, Settings, Package, Store, Users, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { useLang } from '@/lib/i18n';
import { useMyRole } from '@/lib/role';
import { supabase } from '@/integrations/supabase/client';
import { currentLocalAccount, forgetLocalIdentity, offlineSnapshot, syncOffline } from '@/lib/offline';
import { onlineRequired, readAccount, writeAccount } from '@/lib/offline-store';
import { assertDeviceReplace, backupLimit, createDeviceBackup, parseDeviceBackup } from '@/lib/device-backup';

export const Route = createFileRoute('/_authenticated/settings')({
  head: () => ({ meta: [
    { title: 'Settings — FE MANAGEMENT' }, { name: 'description', content: 'FIROZA ENTERPRISE preferences, account management and safe backup controls.' },
    { property: 'og:title', content: 'Settings — FE MANAGEMENT' }, { property: 'og:description', content: 'FIROZA ENTERPRISE preferences, account management and safe backup controls.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }), component: SettingsPage,
});
function SettingsPage() {
  const { lang, setLang, t } = useLang(), role = useMyRole(), client = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(''), [name, setName] = useState('');
  const local = useQuery({ queryKey: ['settings-local'], queryFn: currentLocalAccount });
  const label = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const project = import.meta.env['VITE_SUPABASE_PROJECT_ID'];
  async function action(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); await client.invalidateQueries(); toast.success(label('সম্পন্ন হয়েছে', 'Completed')); }
    catch (e) { toast.error(e instanceof Error ? e.message : label('সম্পন্ন হয়নি', 'Failed')); }
    finally { setBusy(false); }
  }
  async function verified() {
    onlineRequired();
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.id !== role.data?.userId) throw new Error('Sign in again');
    const { error: inactive } = await supabase.rpc('require_active_account');
    if (inactive) throw new Error(inactive.message);
    return data.user.id;
  }
  async function download() {
    await offlineSnapshot();
    const account = await currentLocalAccount();
    if (!account || !project) throw new Error('Saved account unavailable');
    const url = URL.createObjectURL(new Blob([createDeviceBackup(account, project)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `FE-device-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(file: File) {
    const uid = await verified();
    if (file.size > backupLimit || !project) throw new Error('Maximum file size: 25 MB');
    const backup = parseDeviceBackup(await file.text(), uid, project);
    assertDeviceReplace(await readAccount(uid));
    if (!window.confirm(label('শুধু এই ডিভাইসের সংরক্ষিত হিসাব বদলাবে; অনলাইনের তথ্য বদলাবে না। চালিয়ে যাবেন?', 'Replace this device’s saved view only? Online records will not change.'))) return;
    await offlineSnapshot();
    await writeAccount(uid, current => {
      assertDeviceReplace(current);
      if (!current?.role.isActive) throw new Error('Account unavailable');
      return { ...current, snapshot: backup.snapshot, updatedAt: backup.createdAt, extras: {} };
    });
    // Online pages immediately read current server accounts; the file is only an offline-view recovery.
  }
  return <AppShell title={t('nav_settings')}>
    <h1 className="page-title mb-5 flex items-center gap-2"><Settings className="h-6 w-6" />{t('nav_settings')}</h1>
    {role.data?.isAdmin && <Button asChild variant="outline" className="mb-4"><Link to="/access-control"><ShieldCheck />{labeLAccess(lang)}</Link></Button>}
    <section className="border-b border-border py-4 space-y-4">
      <h2 className="text-lg font-semibold">{label('অ্যাকাউন্ট ও ভাষা', 'Account & language')}</h2>
      <p className="text-sm text-muted-foreground">{role.data?.fullName} · {role.data?.isAdmin ? 'Admin' : 'SR'}</p>
      <div className="flex gap-2"><Button variant={lang === 'bn' ? 'default' : 'outline'} onClick={() => setLang('bn')}>বাংলা</Button><Button variant={lang === 'en' ? 'default' : 'outline'} onClick={() => setLang('en')}>English</Button></div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void action(async () => { const uid = await verified(); const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', uid); if (error) throw error; setName(''); }); }}>
        <label className="min-w-0 flex-1"><span className="label">{t('fullName')}</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={role.data?.fullName} required maxLength={120} /></label>
        <Button className="self-end" type="submit" disabled={busy || !name.trim()}>{t('save')}</Button>
      </form>
    </section>
    {role.data?.isAdmin && <section className="border-b border-border py-5 space-y-3"><h2 className="text-lg font-semibold">{label('তালিকা ব্যবস্থাপনা', 'Manage lists')}</h2><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/products"><Package />{t('nav_products')}</Link></Button><Button asChild variant="outline"><Link to="/retailers"><Store />{t('nav_retailers')}</Link></Button><Button asChild variant="outline"><Link to="/salesmen"><Users />{t('nav_salesmen')}</Link></Button></div><p className="text-sm text-muted-foreground">{label('লেনদেন বা স্টক যুক্ত পণ্য ও ডিলার মুছবেন না—বন্ধ করুন। SR বন্ধ করলেও পুরোনো হিসাব থাকবে। পোস্ট করা লেনদেন সরাসরি বদলানো বা মুছতে দেওয়া হয় না।', 'Deactivate products, dealers and SRs with stock or history. Posted transactions cannot be directly edited or deleted.')}</p></section>}
    <section className="border-b border-border py-5 space-y-3">
      <h2 className="text-lg font-semibold">{label('এই ডিভাইসের ব্যাকআপ', 'Device backup')}</h2>
      <p className="text-sm text-muted-foreground">{label('শুধু এই অ্যাকাউন্টে দেখা সংরক্ষিত হিসাব। এটি পুরো অনলাইন ব্যাকআপ নয়। ফাইল গোপন রাখুন। যাচাই বাকি এন্ট্রি রিস্টোর করে পুনরায় পোস্ট করা হবে না।', 'Saved accounts visible to this account only, not a full online backup. Keep the file private. Pending entries cannot be restored or replayed automatically.')}</p>
      <p className="text-sm">{label('যাচাই বাকি', 'Pending')}: {local.data?.entries.length ?? 0} · {label('শেষ সংরক্ষণ', 'Last saved')}: {local.data?.updatedAt ? new Date(local.data.updatedAt).toLocaleString('en-GB') : '—'}</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void action(download)}><Download />{label('ব্যাকআপ ডাউনলোড', 'Download backup')}</Button><Button variant="outline" asChild disabled={busy}><label className="cursor-pointer"><Upload />{label('ডিভাইসে রিস্টোর', 'Restore device view')}<input aria-label="Restore backup file" type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void action(() => restore(file)); e.target.value = ''; }} /></label></Button><Button variant="outline" disabled={busy} onClick={() => void action(async () => { await verified(); await syncOffline(); })}>{label('অনলাইনে মিলিয়ে নিন', 'Synchronize')}</Button></div>
    </section>
    {role.data?.isAdmin && <section className="border-b border-border py-5 space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck />{label('পূর্ণ অনলাইন ব্যাকআপ ও রিস্টোর', 'Full online backup & restore')}</h2>
      <p className="text-sm">{label('Lovable এ: More → Database → Manage → Settings → Export project data → Export data → Database → Export → Start export। ডাউনলোডের লিংক ইমেইলে অথবা More → Storage-এ পাওয়া যায়। এতে সম্পূর্ণ তথ্য, কাঠামো ও ব্যবহারকারীর অ্যাকাউন্ট থাকে।', 'In Lovable: More → Database → Manage → Settings → Export project data → Export data → Database → Export → Start export. Download from the email link or More → Storage. Includes the complete database, structure and user accounts.')}</p>
      <p className="text-sm text-muted-foreground">{label('স্বয়ংক্রিয় ব্যাকআপ দিনে একবার, প্রায় ১৪ দিন পর্যন্ত। More → Database → Manage → Backups-এ UTC সময় দেখে Restore to this backup বেছে নিন। এর পরের সব পরিবর্তন হারাবে, কাঠামোও আগের অবস্থায় যাবে এবং কয়েক মিনিট হিসাব ব্যবহার করা যাবে না। আগে বর্তমান তথ্য এক্সপোর্ট করুন; রিস্টোরের পরে অ্যাপ যাচাই করতে হবে।', 'Daily snapshots are retained up to roughly 14 days. Check the UTC timestamps at More → Database → Manage → Backups, then Restore to this backup. Later changes are permanently lost, schema also reverts, and the database is unavailable for a few minutes. Export first and test the app afterward.')}</p>
      <p className="text-sm text-muted-foreground">{label('স্টোরেজের ফাইল কোনো ব্যাকআপ বা এক্সপোর্টে থাকে না—More → Storage থেকে আলাদা ডাউনলোড করুন। নির্দিষ্ট মুহূর্ত বা শুধু একটি তালিকা রিস্টোর নেই। এক্সপোর্ট: ১৫ GB পর্যন্ত ডেটাবেস, ৫ GB ফাইল, প্রতি ২৪ ঘণ্টায় একবার; ব্যাকএন্ড চালু থাকা প্রয়োজন।', 'Storage files are not included in snapshots or exports; download separately from More → Storage. No arbitrary-time or per-table restore. Export limits: 15 GB database, 5 GB file, once every 24 hours; backend must be running.')}</p>
      <h3 className="font-semibold text-destructive">{label('সব ব্যবসায়িক হিসাব রিসেট', 'Reset all business accounts')}</h3>
      <p className="text-sm">{label('এই অ্যাপে অনলাইনের সব হিসাব মুছে ফেলার বোতাম যুক্ত করা হয়নি। এতে স্থায়ী হিসাবের ইতিহাস ও অন্য ডিভাইসের বাকি এন্ট্রি অসঙ্গত হবে। পূর্ণ রিসেটের জন্য আগে সম্পূর্ণ ব্যাকআপ, সব SR-এর সিঙ্ক ও পুরোনো হিসাব সংরক্ষণসহ আলাদা রিসেট পরিকল্পনা প্রয়োজন।', 'A full online erase is not enabled. It would break immutable history and other devices’ pending entries. It requires a complete backup, all SR devices synchronized, and a separate audited reset plan preserving prior accounts.')}</p>
    </section>}
    <section className="py-5 space-y-3"><h2 className="text-lg font-semibold text-destructive">{label('শুধু এই ডিভাইসের সংরক্ষণ রিসেট', 'Reset device cache only')}</h2><p className="text-sm text-muted-foreground">{label('অনলাইনের হিসাব অক্ষত থাকবে। বাকি এন্ট্রি থাকলে রিসেট বন্ধ থাকবে; সাইন আউট হবে। পরে অফলাইনে খোলার আগে আবার অনলাইনে হিসাব সংরক্ষণ করুন। নিশ্চিত করতে RESET লিখুন।', 'Online accounts remain unchanged. Pending entries block reset. You will be signed out. Reconnect to save accounts before using offline again. Type RESET to confirm.')}</p><input aria-label="Reset confirmation" className="input max-w-xs" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" /><Button variant="destructive" disabled={busy || confirm !== 'RESET' || !!local.data?.entries.length} onClick={() => void action(async () => { const uid = await verified(); await client.cancelQueries(); await writeAccount(uid, current => { assertDeviceReplace(current); if (!current) throw new Error('Account unavailable'); return { role: current.role, entries: [], extras: {} }; }); forgetLocalIdentity(); await supabase.auth.signOut(); client.clear(); await navigate({ to: '/auth', replace: true }); })}><Trash2 />{label('ডিভাইসের সংরক্ষণ মুছুন', 'Clear device cache')}</Button></section>
  </AppShell>;
}