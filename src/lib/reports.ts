import type { AccountingSnapshot } from './accounting';

export type ReportKind = 'sales' | 'payments' | 'issues' | 'returns' | 'deposits' | 'settlements' | 'products' | 'imei' | 'dealers' | 'sr';
export type DocumentKind = 'invoice' | 'receipt' | 'issue' | 'return' | 'settlement' | 'letterhead';
export interface Report { title: string; columns: string[]; rows: (string | number)[][] }
export interface Filters { from: string; to: string; sr: string; dealer: string }
export interface BusinessDocument extends Report {
  reference: string; date: string; party: string; address?: string | undefined; phone?: string | undefined; sr?: string | undefined;
  totals: [string, number][]; note?: string;
}
export const reportTitles: Record<ReportKind, string> = {
  sales: 'Sales / বিক্রি', payments: 'Collections / আদায়', issues: 'Stock issues / মাল ইস্যু',
  returns: 'Returns / ফেরত', deposits: 'Deposits / জমা', settlements: 'Settlements / সেটেলমেন্ট',
  products: 'Products / পণ্য', imei: 'IMEI register / IMEI তালিকা', dealers: 'Dealer balances / ডিলার হিসাব', sr: 'SR balances / SR হিসাব',
};
export const documentTitles: Record<DocumentKind, string> = {
  invoice: 'SALES INVOICE / বিক্রয় চালান', receipt: 'MONEY RECEIPT / টাকা প্রাপ্তির রসিদ',
  issue: 'STOCK ISSUE VOUCHER / মাল ইস্যু', return: 'STOCK RETURN VOUCHER / মাল ফেরত',
  settlement: 'SETTLEMENT VOUCHER / হিসাব নিষ্পত্তি', letterhead: 'LETTERHEAD / প্রতিষ্ঠানের প্যাড',
};
export const reference = (prefix: string, id: string) => `${prefix}-${id.toUpperCase()}`;
export const displayDate = (date: string) => date ? new Date(date).toLocaleString('en-GB') : '—';
export function inDateRange(at: string, from: string, to: string) {
  const date = at.slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}
export function buildReport(d: AccountingSnapshot, kind: ReportKind, f: Filters): Report {
  const name = (id: string) => d.profiles.find(p => p.id === id)?.full_name || id;
  const dealer = (id: string) => d.retailers.find(p => p.id === id)?.name || id;
  const product = (id: string) => d.products.find(p => p.id === id)?.name || id;
  const unit = (id: string | null) => d.imeiUnits.find(u => u.id === id)?.imei || '—';
  const match = (at: string, sr: string, rid?: string) => inDateRange(at, f.from, f.to) && (!f.sr || sr === f.sr) && (!f.dealer || rid === f.dealer);
  const sales = d.sales.filter(s => match(s.sold_at, s.salesman_id, s.retailer_id));
  const payments = d.payments.filter(s => match(s.paid_at, s.salesman_id, s.retailer_id));
  let columns: string[] = [], rows: Report['rows'] = [];
  switch (kind) {
    case 'sales': columns = ['Reference','Date','Dealer','SR','Total (BDT)','Cash (BDT)','Due at sale (BDT)','Note']; rows = sales.map(s => [reference('INV',s.id),displayDate(s.sold_at),dealer(s.retailer_id),name(s.salesman_id),s.total_amount,s.paid_amount,s.total_amount-s.paid_amount,s.note]); break;
    case 'payments': columns = ['Reference','Date','Dealer','SR','Amount (BDT)','Note']; rows = payments.map(s => [reference('MR',s.id),displayDate(s.paid_at),dealer(s.retailer_id),name(s.salesman_id),s.amount,s.note]); break;
    case 'issues': {
      columns = ['Reference','Date','SR','Product','Quantity','IMEI'];
      const parents = d.stockIssues.filter(s => match(s.issued_at,s.salesman_id));
      rows = parents.flatMap(s => d.issueItems.filter(i => i.issue_id===s.id).map(i => [reference('ISS',s.id),displayDate(s.issued_at),name(s.salesman_id),product(i.product_id),i.quantity,unit(i.imei_unit_id)])); break;
    }
    case 'returns': columns = ['Reference','Date','SR','Product','Quantity','IMEI','Condition']; rows = d.returns.filter(s=>match(s.returned_at,s.salesman_id)).map(s=>[reference('RET',s.id),displayDate(s.returned_at),name(s.salesman_id),product(s.product_id),s.quantity,unit(s.imei_unit_id),s.is_damaged?'Damaged':'Good']); break;
    case 'deposits': columns=['Reference','Date','SR','Amount (BDT)','Note']; rows=d.deposits.filter(s=>match(s.deposited_at,s.salesman_id)).map(s=>[reference('DEP',s.id),displayDate(s.deposited_at),name(s.salesman_id),s.amount,s.note]); break;
    case 'settlements': columns=['Reference','Date','SR','Returned pcs','Deposited (BDT)','Note']; rows=d.settlements.filter(s=>match(s.created_at,s.salesman_id)).map(s=>[reference('SET',s.id),displayDate(s.created_at),name(s.salesman_id),d.returns.filter(r=>r.settlement_id===s.id).reduce((a,r)=>a+r.quantity,0),d.deposits.filter(r=>r.settlement_id===s.id).reduce((a,r)=>a+r.amount,0),s.note]); break;
    case 'products': columns=['Product','Model','Tracking','Price (BDT)','Active']; rows=d.products.map(p=>[p.name,p.model,p.category==='button_phone'?'Quantity / IMEI-free':'IMEI',p.price,p.is_active?'Yes':'No']); break;
    case 'imei': columns=['Product','IMEI','Status','SR','Condition']; rows=d.imeiUnits.filter(u=>!f.sr||u.current_salesman===f.sr).map(u=>[product(u.product_id),u.imei,u.status,u.current_salesman?name(u.current_salesman):'—',u.is_damaged?'Damaged':'Good']); break;
    case 'dealers': {
      columns=['Dealer','Phone','Address','Sales (BDT)','Received (BDT)','Closing due (BDT)'];
      const cutoffSales=d.sales.filter(s=>(!f.to||s.sold_at.slice(0,10)<=f.to)&&(!f.sr||s.salesman_id===f.sr));
      const cutoffPayments=d.payments.filter(s=>(!f.to||s.paid_at.slice(0,10)<=f.to)&&(!f.sr||s.salesman_id===f.sr));
      rows=d.retailers.filter(r=>!f.dealer||r.id===f.dealer).map(r=>{
        const ss=cutoffSales.filter(s=>s.retailer_id===r.id), pp=cutoffPayments.filter(p=>p.retailer_id===r.id);
        const total=ss.reduce((a,s)=>a+s.total_amount,0), cash=ss.reduce((a,s)=>a+s.paid_amount,0)+pp.reduce((a,p)=>a+p.amount,0);
        return [r.name,r.phone,r.address,total,cash,Math.max(0,total-cash)];
      }); break;
    }
    case 'sr': {
      columns=['SR','Collected (BDT)','Deposited (BDT)','Cash on hand (BDT)','Remaining pcs'];
      const ids=new Set(d.roles.filter(r=>r.role==='salesman').map(r=>r.user_id));
      const before=(at:string)=>!f.to||at.slice(0,10)<=f.to;
      rows=d.profiles.filter(p=>ids.has(p.id)&&(!f.sr||p.id===f.sr)).map(p=>{
        const ss=d.sales.filter(s=>s.salesman_id===p.id&&before(s.sold_at));
        const cash=ss.reduce((a,s)=>a+s.paid_amount,0)+d.payments.filter(s=>s.salesman_id===p.id&&before(s.paid_at)).reduce((a,s)=>a+s.amount,0);
        const dep=d.deposits.filter(s=>s.salesman_id===p.id&&before(s.deposited_at)).reduce((a,s)=>a+s.amount,0);
        const ii=new Set(d.stockIssues.filter(s=>s.salesman_id===p.id&&before(s.issued_at)).map(s=>s.id)), si=new Set(ss.map(s=>s.id));
        const qty=d.issueItems.filter(i=>ii.has(i.issue_id)).reduce((a,i)=>a+i.quantity,0)-d.saleItems.filter(i=>si.has(i.sale_id)).reduce((a,i)=>a+i.quantity,0)-d.returns.filter(r=>r.salesman_id===p.id&&before(r.returned_at)).reduce((a,r)=>a+r.quantity,0);
        return [p.full_name,cash,dep,cash-dep,qty];
      }); break;
    }
  }
  return {title:reportTitles[kind],columns,rows};
}

export function buildDocument(d: AccountingSnapshot, kind: DocumentKind, id: string): BusinessDocument | null {
  const product=(pid:string)=>d.products.find(p=>p.id===pid)?.name||pid;
  const imei=(uid:string|null)=>d.imeiUnits.find(u=>u.id===uid)?.imei||'—';
  const sr=(uid:string)=>d.profiles.find(p=>p.id===uid)?.full_name||uid;
  const base={title:documentTitles[kind],reference:'',date:'',party:'',columns:[] as string[],rows:[] as Report['rows'],totals:[] as [string,number][]};
  if(kind==='letterhead') return base;
  if(kind==='invoice') {
    const s=d.sales.find(s=>s.id===id); if(!s)return null;
    const r=d.retailers.find(r=>r.id===s.retailer_id);
    return {...base,reference:reference('INV',s.id),date:displayDate(s.sold_at),party:r?.name||s.retailer_id,address:r?.address,phone:r?.phone,sr:sr(s.salesman_id),note:s.note,
      columns:['Product / পণ্য','IMEI','Qty','Rate (BDT)','Amount (BDT)'],rows:d.saleItems.filter(i=>i.sale_id===id).map(i=>[product(i.product_id),imei(i.imei_unit_id),i.quantity,i.unit_price,i.quantity*i.unit_price]),
      totals:[['Total / মোট',s.total_amount],['Cash received / নগদ',s.paid_amount],['Due at sale / চালানে বাকি',s.total_amount-s.paid_amount]]};
  }
  if(kind==='receipt') {
    const p=d.payments.find(p=>p.id===id); if(!p)return null; const r=d.retailers.find(r=>r.id===p.retailer_id);
    return {...base,reference:reference('MR',id),date:displayDate(p.paid_at),party:r?.name||p.retailer_id,address:r?.address,phone:r?.phone,sr:sr(p.salesman_id),note:p.note,
      columns:['Particulars / বিবরণ','Amount (BDT)'],rows:[['Dealer payment / ডিলারের বাকি আদায়',p.amount]],totals:[['Received / প্রাপ্ত',p.amount]]};
  }
  if(kind==='issue') {
    const s=d.stockIssues.find(s=>s.id===id); if(!s)return null;
    const items=d.issueItems.filter(i=>i.issue_id===id);
    return {...base,reference:reference('ISS',id),date:displayDate(s.issued_at),party:sr(s.salesman_id),note:s.note,columns:['Product / পণ্য','IMEI','Quantity / পরিমাণ'],rows:items.map(i=>[product(i.product_id),imei(i.imei_unit_id),i.quantity]),totals:[['Total pieces / মোট পিস',items.reduce((a,i)=>a+i.quantity,0)]]};
  }
  if(kind==='return') {
    const r=d.returns.find(r=>r.id===id); if(!r)return null;
    return {...base,reference:reference('RET',id),date:displayDate(r.returned_at),party:sr(r.salesman_id),columns:['Product / পণ্য','IMEI','Quantity','Condition'],rows:[[product(r.product_id),imei(r.imei_unit_id),r.quantity,r.is_damaged?'Damaged / নষ্ট':'Good / ভালো']],totals:[['Total pieces / মোট পিস',r.quantity]]};
  }
  const s=d.settlements.find(s=>s.id===id); if(!s)return null;
  const returns=d.returns.filter(r=>r.settlement_id===id), deps=d.deposits.filter(r=>r.settlement_id===id);
  return {...base,reference:reference('SET',id),date:displayDate(s.created_at),party:sr(s.salesman_id),note:s.note,
    columns:['Particulars / বিবরণ','IMEI / Note','Quantity','Deposit (BDT)'],rows:[...returns.map(r=>[`${product(r.product_id)} (${r.is_damaged?'Damaged':'Good'})`,imei(r.imei_unit_id),r.quantity,0]),...deps.map(p=>['Cash deposit / টাকা জমা',p.note,0,p.amount])],totals:[['Returned pieces / ফেরত পিস',returns.reduce((a,r)=>a+r.quantity,0)],['Deposit (BDT) / জমা',deps.reduce((a,p)=>a+p.amount,0)]]};
}