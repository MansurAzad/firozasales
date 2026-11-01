import { formatBDT } from '@/lib/money';
import type { BusinessDocument, Report } from '@/lib/reports';

export function BusinessPaper({report,document:doc,subtitle,letter}:{report:Report;document?:BusinessDocument;subtitle?:string;letter?:{subject:string;body:string;date:string;recipient:string}}) {
  const chunks: Report['rows'][]=[];
  for(let i=0;i<report.rows.length;i+=12)chunks.push(report.rows.slice(i,i+12));
  if(!chunks.length)chunks.push([]);
  return <>{chunks.map((rows,page)=><article className="paper-page" key={page}>
    <header className="paper-brand"><div className="paper-monogram">FE</div><div><h2>FIROZA ENTERPRISE</h2><p>FE MANAGEMENT</p></div></header>
    <div className="paper-heading"><h3>{report.title}</h3><span>{page+1} / {chunks.length}</span></div>
    {subtitle&&<p className="paper-subtitle">{subtitle}</p>}
    {doc&&doc.reference&&<div className="paper-details"><div><strong>To / প্রাপক:</strong> {doc.party}{doc.address&&<p>{doc.address}</p>}{doc.phone&&<p>{doc.phone}</p>}{doc.sr&&<p>SR: {doc.sr}</p>}</div><div><p><strong>Ref:</strong> {doc.reference}</p><p><strong>Date:</strong> {doc.date}</p></div></div>}
    {letter?<div className="paper-letter"><p>Date: {letter.date}</p><p>To: {letter.recipient}</p><h4>Subject / বিষয়: {letter.subject}</h4><div>{letter.body}</div></div>:<>
      <table className="paper-table"><thead><tr><th>#</th>{report.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}><td>{page*12+i+1}</td>{row.map((value,j)=><td key={j}>{typeof value==='number'?value.toLocaleString('en-US',{maximumFractionDigits:2}):value}</td>)}</tr>)}</tbody></table>
      {!rows.length&&<p className="paper-subtitle">No records / কোনো তথ্য নেই</p>}
    </>}
    {doc&&page===chunks.length-1&&<><div className="paper-totals">{doc.totals.map(([label,value])=><p key={label}><span>{label}</span><strong>{label.includes('pieces')?value:formatBDT(value)}</strong></p>)}</div>{doc.note&&<p className="paper-note">Note / নোট: {doc.note}</p>}
      <div className="paper-signatures"><span>Prepared / প্রস্তুতকারী</span><span>Received / গ্রহণকারী</span><span>Authorized / অনুমোদনকারী</span></div></>}
    <footer className="paper-footer"><span>FIROZA ENTERPRISE · {doc?.reference||report.title}</span><span>{page+1} / {chunks.length}</span></footer>
  </article>)}</>;
}