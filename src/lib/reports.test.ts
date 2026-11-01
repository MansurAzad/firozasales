import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
import type { AccountingSnapshot } from './accounting';
import { buildDocument, buildReport, inDateRange } from './reports';
const d: AccountingSnapshot = {
  profiles:[{id:'u',full_name:'SR',is_active:true,created_at:''}],roles:[{id:'role',user_id:'u',role:'salesman'}],
  products:[{id:'b',name:'Button phone',category:'button_phone',price:2500,model:'',created_at:'',is_active:true}],
  retailers:[{id:'r',name:'Dealer',phone:'',address:'',is_active:true,created_at:''}],imeiUnits:[],
  sales:[{id:'s',retailer_id:'r',salesman_id:'u',total_amount:31000,paid_amount:20000,sold_at:'2026-11-01T06:00:00Z',note:''}],
  saleItems:[{id:'i',sale_id:'s',product_id:'b',quantity:2,unit_price:2500,imei_unit_id:null}],
  payments:[{id:'p',retailer_id:'r',salesman_id:'u',amount:3000,paid_at:'2026-11-01T07:00:00Z',note:''}],
  deposits:[],returns:[],settlements:[],stockIssues:[],issueItems:[],
};
const f={from:'',to:'',sr:'',dealer:''};
describe('business document accounting',()=>{
  it('exports button phones without an IMEI at the actual quantity and rate',()=>expect(buildDocument(d,'invoice','s')?.rows).toEqual([['Button phone','—',2,2500,5000]]));
  it('keeps invoice due at 11000 instead of applying later collections to the original invoice',()=>expect(buildDocument(d,'invoice','s')?.totals[2]?.[1]).toBe(11000));
  it('keeps dealer closing due at 8000 after later collection',()=>expect(buildReport(d,'dealers',f).rows[0]?.[5]).toBe(8000));
  it('exports the actual 3000 collection receipt',()=>expect(buildDocument(d,'receipt','p')?.totals[0]?.[1]).toBe(3000));
  it('does not invent a document for a missing transaction',()=>expect(buildDocument(d,'invoice','unknown')).toBeNull());
  it('filters each SR rather than exporting unrelated sales',()=>expect(buildReport(d,'sales',{...f,sr:'other'}).rows).toEqual([]));
  it('includes both date boundaries and excludes earlier dates',()=>{expect(inDateRange('2026-11-01T07:00:00Z','2026-11-01','2026-11-01')).toBe(true);expect(inDateRange('2026-10-31T07:00:00Z','2026-11-01','2026-11-01')).toBe(false);});
});