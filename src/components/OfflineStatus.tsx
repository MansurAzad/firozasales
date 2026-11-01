import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOff, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { useLang } from '@/lib/i18n';
import { currentLocalAccount, syncOffline } from '@/lib/offline';
import { isOffline, type LocalAccount } from '@/lib/offline-store';
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function OfflineStatus() {
  const { lang } = useLang(), queryClient = useQueryClient();
  const [offline, setOffline] = useState(false), [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<LocalAccount>(), [install, setInstall] = useState<InstallEvent>();
  const [error, setError] = useState('');
  async function synchronize() {
    if (isOffline()) return;
    setBusy(true); setError('');
    try { await syncOffline(); await queryClient.invalidateQueries(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setAccount(await currentLocalAccount()); setBusy(false); }
  }
  useEffect(() => {
    const update = () => { setOffline(isOffline()); void currentLocalAccount().then(setAccount); };
    const online = () => { update(); void synchronize(); };
    const prompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    update(); void currentLocalAccount().then(a => { if (a?.snapshot && !isOffline()) void synchronize(); });
    window.addEventListener('online', online); window.addEventListener('offline', update); window.addEventListener('fe-local-change', update); window.addEventListener('beforeinstallprompt', prompt);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', update); window.removeEventListener('fe-local-change', update); window.removeEventListener('beforeinstallprompt', prompt); };
  }, []);
  const pending = account?.entries.length ?? 0;
  return <section aria-label={lang === 'bn' ? 'সংযোগ ও সংরক্ষণ' : 'Connection and storage'} className="mb-4 border-b border-border pb-3 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center gap-2">
      {offline && <WifiOff className="h-4 w-4 text-warning-foreground" />}
      <span>{offline ? (lang === 'bn' ? 'অফলাইন · লোকাল হিসাব' : 'Offline · Local accounts') : (lang === 'bn' ? 'অনলাইন' : 'Online')}</span>
      {account?.updatedAt && <span>{lang === 'bn' ? 'শেষ সংরক্ষণ' : 'Last saved'}: {new Date(account.updatedAt).toLocaleString('en-GB')}</span>}
      {pending > 0 && <strong className="text-warning-foreground">{pending} {lang === 'bn' ? 'এন্ট্রি যাচাই বাকি' : 'entries awaiting verification'}</strong>}
      <Button variant="ghost" size="icon" aria-label={lang === 'bn' ? 'হিসাব মিলিয়ে নিন' : 'Synchronize accounts'} title={lang === 'bn' ? 'হিসাব মিলিয়ে নিন' : 'Synchronize accounts'} disabled={offline || busy} onClick={() => void synchronize()}><RefreshCw className={busy ? 'animate-spin' : ''} /></Button>
      {install && <Button variant="outline" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(undefined); }}><Download />{lang === 'bn' ? 'ইনস্টল' : 'Install'}</Button>}
    </div>
    {(error || account?.entries[0]?.error) && <p role="alert" className="mt-2 flex items-start gap-2 break-words text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{lang === 'bn' ? 'এন্ট্রি লোকালে আছে; যাচাই সম্পন্ন হয়নি: ' : 'Entries remain saved locally; verification incomplete: '}{error || account?.entries[0]?.error}</p>}
  </section>;
}