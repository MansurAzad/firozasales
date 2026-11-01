import { useState } from 'react';
import { Share2, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { canShareFile, shareFile } from '@/lib/file-share';
import { downloadFile } from '@/lib/report-export';

export function ReportShare({ disabled, bn, title, allowExcel, prepare }: {
  disabled: boolean; bn: boolean; title: string; allowExcel: boolean;
  prepare: (format: 'pdf' | 'excel') => Promise<File>;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'pdf' | 'excel'>('pdf');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [sharing, setSharing] = useState(false);
  const supportsShare = file ? canShareFile(file) && !unavailable : false;

  async function create() {
    setBusy(true);
    try { setFile(await prepare(format)); setUnavailable(false); }
    catch { toast.error(bn ? 'ফাইল তৈরি হয়নি; আবার চেষ্টা করুন' : 'Could not prepare the file. Please try again.'); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!file || sharing) return;
    setSharing(true);
    try {
      const result = await shareFile(file, title);
      if (result === 'shared') setOpen(false);
      if (result === 'unavailable') setUnavailable(true);
    } finally { setSharing(false); }
  }

  return <>
    <Button variant="outline" disabled={disabled} onClick={() => { setFile(null); setFormat('pdf'); setUnavailable(false); setOpen(true); }}><Share2 />{bn ? 'শেয়ার' : 'Share'}</Button>
    <Dialog open={open} onOpenChange={value => { if (busy || sharing) return; setOpen(value); if (!value) setFile(null); }}>
      <DialogContent>
        <DialogTitle>{bn ? 'ফাইল শেয়ার' : 'Share file'}</DialogTitle>
        <DialogDescription>{title}</DialogDescription>
        {!file ? <>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={bn ? 'ফাইলের ধরন' : 'File format'}>
            <Button variant={format === 'pdf' ? 'default' : 'outline'} aria-pressed={format === 'pdf'} disabled={busy} onClick={() => setFormat('pdf')}><FileText />PDF</Button>
            {allowExcel && <Button variant={format === 'excel' ? 'default' : 'outline'} aria-pressed={format === 'excel'} disabled={busy} onClick={() => setFormat('excel')}><FileSpreadsheet />Excel</Button>}
          </div>
          <Button disabled={busy} onClick={() => void create()}>{busy ? (bn ? 'ফাইল তৈরি হচ্ছে…' : 'Preparing file…') : (bn ? 'ফাইল তৈরি করুন' : 'Prepare file')}</Button>
        </> : <>
          <p className="break-all text-sm text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>
          {!supportsShare && <p role="status" className="text-sm">{bn ? 'এই ব্রাউজারে সরাসরি ফাইল শেয়ার করা যাচ্ছে না; ডাউনলোড করে পাঠাতে পারবেন।' : 'Direct file sharing is unavailable in this browser. Download the file to send it.'}</p>}
          {supportsShare && <Button disabled={sharing} onClick={() => void send()}><Share2 />{bn ? 'অ্যাপে পাঠান' : 'Send to app'}</Button>}
          <Button variant="outline" disabled={sharing} onClick={() => downloadFile(file, file.name)}><Download />{bn ? 'ডাউনলোড' : 'Download'}</Button>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}