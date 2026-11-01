alter table public.imei_units add column is_damaged boolean not null default false;
update public.imei_units u set is_damaged=true where u.status='in_dealer_stock' and exists(select 1 from public.returns r where r.imei_unit_id=u.id and r.is_damaged and r.returned_at=(select max(r2.returned_at) from public.returns r2 where r2.imei_unit_id=u.id));
create table public.posting_requests(actor_id uuid not null,request_id uuid not null,kind text not null,payload jsonb not null,result_id uuid not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));
grant select on public.posting_requests to authenticated;
grant all on public.posting_requests to service_role;
alter table public.posting_requests enable row level security;
create policy "Own posting receipts" on public.posting_requests for select to authenticated using(actor_id=auth.uid());
create or replace function public.require_active_account() returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'Account is inactive or not signed in'; end if;
 if not(public.has_role(v_uid,'admin') or public.has_role(v_uid,'salesman')) then raise exception 'Account has no authorized role'; end if;
 return v_uid;
end $$;
revoke all on function public.require_active_account() from public,anon;
grant execute on function public.require_active_account() to authenticated;
create or replace function public.set_sr_active(p_user_id uuid,p_active boolean) returns void language plpgsql security definer set search_path=public as $$
declare v_uid uuid;
begin
 v_uid:=public.require_active_account();
 if not public.has_role(v_uid,'admin') then raise exception 'Only admin can change account status'; end if;
 if not public.has_role(p_user_id,'salesman') or public.has_role(p_user_id,'admin') then raise exception 'Select an SR account'; end if;
 update public.profiles set is_active=p_active where id=p_user_id;
end $$;
revoke all on function public.set_sr_active(uuid,boolean) from public,anon;
grant execute on function public.set_sr_active(uuid,boolean) to authenticated;
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;
create or replace function public.post_transaction(p_kind text,p_payload jsonb,p_request_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_actor uuid; v_sr uuid; v_admin boolean; v_result uuid; v_receipt public.posting_requests%rowtype;
 v_item jsonb; v_unit_json jsonb; v_product public.products%rowtype; v_unit public.imei_units%rowtype;
 v_qty integer; v_price numeric; v_total numeric:=0; v_paid numeric:=0; v_remaining integer;
 v_available numeric; v_deposit_total numeric:=0; v_retailer uuid; v_damage boolean;
begin
 v_actor:=public.require_active_account(); v_admin:=public.has_role(v_actor,'admin');
 if p_request_id is null or p_payload is null or p_kind not in('issue','sale','settlement','payment') then raise exception 'Invalid posting request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text,0));
 select * into v_receipt from public.posting_requests where actor_id=v_actor and request_id=p_request_id;
 if found then
  if v_receipt.kind<>p_kind or v_receipt.payload<>p_payload then raise exception 'Retry payload changed; start a new request'; end if;
  return v_receipt.result_id;
 end if;
 v_sr:=case when v_admin then coalesce(nullif(p_payload->>'salesman_id','')::uuid,v_actor) else v_actor end;
 if not v_admin and p_payload ? 'salesman_id' and (p_payload->>'salesman_id')::uuid is distinct from v_actor then raise exception 'Cannot post for another SR'; end if;
 if p_kind='issue' and not v_admin then raise exception 'Only admin can issue stock'; end if;
 perform 1 from public.profiles where id=v_sr and is_active for update;
 if not found or not public.has_role(v_sr,'salesman') then raise exception 'Select an active SR'; end if;
 if p_kind in('sale','payment') then
  v_retailer:=(p_payload->>'retailer_id')::uuid;
  if not exists(select 1 from public.retailers where id=v_retailer and is_active) then raise exception 'Select an active dealer'; end if;
 end if;
 if p_kind in('issue','sale') then
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')=0 then raise exception 'Add stock items'; end if;
  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid and is_active;
   if not found then raise exception 'Invalid or inactive product'; end if;
   if v_product.category='smartphone' then
    if jsonb_typeof(v_item->'unit_ids') is distinct from 'array' or jsonb_array_length(v_item->'unit_ids')=0 then raise exception 'Scan at least one IMEI'; end if;
    v_qty:=jsonb_array_length(v_item->'unit_ids');
   else
    if coalesce(v_item->>'quantity','') !~ '^[0-9]+$' then raise exception 'Quantity must be a positive integer'; end if;
    v_qty:=(v_item->>'quantity')::integer;
    if v_qty<=0 then raise exception 'Quantity must be a positive integer'; end if;
   end if;
   if p_kind='sale' then
    v_price:=(v_item->>'unit_price')::numeric;
    if v_price is null or v_price<0 or v_price::text in('NaN','Infinity','-Infinity') or v_price<>round(v_price,2) then raise exception 'Invalid unit price'; end if;
    v_total:=v_total+v_qty*v_price;
   end if;
  end loop;
  if p_kind='sale' then
   v_paid:=coalesce((p_payload->>'paid_amount')::numeric,0);
   if v_paid<0 or v_paid>v_total or v_paid::text in('NaN','Infinity','-Infinity') or v_paid<>round(v_paid,2) then raise exception 'Cash must be between zero and sale total'; end if;
   insert into public.sales(salesman_id,retailer_id,total_amount,paid_amount,note) values(v_sr,v_retailer,v_total,v_paid,coalesce(p_payload->>'note','')) returning id into v_result;
  else
   insert into public.stock_issues(salesman_id,issued_by,note) values(v_sr,v_actor,coalesce(p_payload->>'note','')) returning id into v_result;
  end if;
  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
   v_price:=coalesce((v_item->>'unit_price')::numeric,0);
   if v_product.category='smartphone' then
    for v_unit_json in select value from jsonb_array_elements(v_item->'unit_ids') loop
     select * into v_unit from public.imei_units where id=(v_unit_json#>>'{}')::uuid for update;
     if not found or v_unit.product_id is distinct from v_product.id or v_unit.is_damaged then raise exception 'Unknown, mismatched or damaged IMEI'; end if;
     if p_kind='issue' then
      if v_unit.status<>'in_dealer_stock' then raise exception 'IMEI is not in company stock'; end if;
      insert into public.stock_issue_items(issue_id,product_id,quantity,imei_unit_id) values(v_result,v_product.id,1,v_unit.id);
      update public.imei_units set status='with_salesman',current_salesman=v_sr,issued_at=now() where id=v_unit.id;
     else
      if v_unit.status<>'with_salesman' or v_unit.current_salesman is distinct from v_sr then raise exception 'IMEI is not held by this SR'; end if;
      insert into public.sale_items(sale_id,product_id,quantity,unit_price,imei_unit_id) values(v_result,v_product.id,1,v_price,v_unit.id);
      update public.imei_units set status='sold',current_salesman=null,sold_at=now() where id=v_unit.id;
     end if;
    end loop;
   else
    v_qty:=(v_item->>'quantity')::integer;
    if p_kind='issue' then
     insert into public.stock_issue_items(issue_id,product_id,quantity) values(v_result,v_product.id,v_qty);
    else
     select coalesce((select sum(i.quantity) from public.stock_issue_items i join public.stock_issues h on h.id=i.issue_id where h.salesman_id=v_sr and i.product_id=v_product.id),0)-coalesce((select sum(i.quantity) from public.sale_items i join public.sales h on h.id=i.sale_id where h.salesman_id=v_sr and i.product_id=v_product.id),0)-coalesce((select sum(quantity) from public.returns where salesman_id=v_sr and product_id=v_product.id),0) into v_remaining;
     if v_qty>v_remaining then raise exception 'Quantity exceeds SR stock (% remaining)',v_remaining; end if;
     insert into public.sale_items(sale_id,product_id,quantity,unit_price) values(v_result,v_product.id,v_qty,v_price);
    end if;
   end if;
  end loop;
 elsif p_kind='payment' then
  v_paid:=(p_payload->>'amount')::numeric;
  select coalesce((select sum(total_amount-paid_amount) from public.sales where salesman_id=v_sr and retailer_id=v_retailer),0)-coalesce((select sum(amount) from public.retailer_payments where salesman_id=v_sr and retailer_id=v_retailer),0) into v_available;
  if v_paid is null or v_paid<=0 or v_paid>v_available or v_paid::text in('NaN','Infinity','-Infinity') or v_paid<>round(v_paid,2) then raise exception 'Payment exceeds dealer due or is invalid (% due)',v_available; end if;
  insert into public.retailer_payments(salesman_id,retailer_id,amount,note) values(v_sr,v_retailer,v_paid,coalesce(p_payload->>'note','')) returning id into v_result;
 else
  if jsonb_typeof(p_payload->'returns') is distinct from 'array' or jsonb_typeof(p_payload->'deposits') is distinct from 'array' then raise exception 'Invalid settlement'; end if;
  if jsonb_array_length(p_payload->'returns')+jsonb_array_length(p_payload->'deposits')=0 then raise exception 'Add a return or deposit'; end if;
  select coalesce((select sum(paid_amount) from public.sales where salesman_id=v_sr),0)+coalesce((select sum(amount) from public.retailer_payments where salesman_id=v_sr),0)-coalesce((select sum(amount) from public.deposits where salesman_id=v_sr),0) into v_available;
  for v_item in select value from jsonb_array_elements(p_payload->'deposits') loop
   v_paid:=(v_item->>'amount')::numeric;
   if v_paid is null or v_paid<=0 or v_paid::text in('NaN','Infinity','-Infinity') or v_paid<>round(v_paid,2) then raise exception 'Invalid deposit'; end if;
   v_deposit_total:=v_deposit_total+v_paid;
  end loop;
  if v_deposit_total>v_available then raise exception 'Deposits exceed cash on hand (% available)',v_available; end if;
  insert into public.settlements(salesman_id,note) values(v_sr,coalesce(p_payload->>'note','')) returning id into v_result;
  for v_item in select value from jsonb_array_elements(p_payload->'returns') loop
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
   if not found then raise exception 'Unknown return product'; end if;
   v_damage:=coalesce((v_item->>'is_damaged')::boolean,false);
   if v_product.category='smartphone' then
    if jsonb_typeof(v_item->'unit_ids') is distinct from 'array' or jsonb_array_length(v_item->'unit_ids')=0 then raise exception 'Scan return IMEIs'; end if;
    for v_unit_json in select value from jsonb_array_elements(v_item->'unit_ids') loop
     select * into v_unit from public.imei_units where id=(v_unit_json#>>'{}')::uuid for update;
     if not found or v_unit.product_id is distinct from v_product.id or v_unit.status<>'with_salesman' or v_unit.current_salesman is distinct from v_sr then raise exception 'Wrong return IMEI'; end if;
     insert into public.returns(settlement_id,salesman_id,product_id,quantity,imei_unit_id,is_damaged) values(v_result,v_sr,v_product.id,1,v_unit.id,v_damage);
     update public.imei_units set status='in_dealer_stock',current_salesman=null,returned_at=now(),is_damaged=v_damage where id=v_unit.id;
    end loop;
   else
    if coalesce(v_item->>'quantity','') !~ '^[0-9]+$' then raise exception 'Return quantity must be a positive integer'; end if;
    v_qty:=(v_item->>'quantity')::integer;
    select coalesce((select sum(i.quantity) from public.stock_issue_items i join public.stock_issues h on h.id=i.issue_id where h.salesman_id=v_sr and i.product_id=v_product.id),0)-coalesce((select sum(i.quantity) from public.sale_items i join public.sales h on h.id=i.sale_id where h.salesman_id=v_sr and i.product_id=v_product.id),0)-coalesce((select sum(quantity) from public.returns where salesman_id=v_sr and product_id=v_product.id),0) into v_remaining;
    if v_qty<=0 or v_qty>v_remaining then raise exception 'Return exceeds SR stock (% remaining)',v_remaining; end if;
    insert into public.returns(settlement_id,salesman_id,product_id,quantity,is_damaged) values(v_result,v_sr,v_product.id,v_qty,v_damage);
   end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_payload->'deposits') loop
   insert into public.deposits(settlement_id,salesman_id,amount,note) values(v_result,v_sr,(v_item->>'amount')::numeric,coalesce(v_item->>'note',''));
  end loop;
 end if;
 insert into public.posting_requests(actor_id,request_id,kind,payload,result_id) values(v_actor,p_request_id,p_kind,p_payload,v_result);
 return v_result;
end $$;
revoke all on function public.post_transaction(text,jsonb,uuid) from public,anon;
grant execute on function public.post_transaction(text,jsonb,uuid) to authenticated;
revoke insert,update,delete on public.stock_issues,public.stock_issue_items,public.sales,public.sale_items,public.retailer_payments,public.settlements,public.deposits,public.returns from authenticated;
revoke all on function public.issue_imei(text,uuid),public.sell_imei(text,uuid),public.return_imei(text,uuid) from public,anon,authenticated;
create or replace function public.accounting_snapshot() returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 perform public.require_active_account();
 return jsonb_build_object(
 'profiles',coalesce((select jsonb_agg(to_jsonb(t)) from public.profiles t),'[]'::jsonb),
 'roles',coalesce((select jsonb_agg(to_jsonb(t)) from public.user_roles t),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.products t),'[]'::jsonb),
 'imeiUnits',coalesce((select jsonb_agg(to_jsonb(t)) from public.imei_units t),'[]'::jsonb),
 'retailers',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.retailers t),'[]'::jsonb),
 'sales',coalesce((select jsonb_agg(to_jsonb(t) order by t.sold_at desc) from public.sales t),'[]'::jsonb),
 'saleItems',coalesce((select jsonb_agg(to_jsonb(t)) from public.sale_items t),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(t) order by t.paid_at desc) from public.retailer_payments t),'[]'::jsonb),
 'deposits',coalesce((select jsonb_agg(to_jsonb(t) order by t.deposited_at desc) from public.deposits t),'[]'::jsonb),
 'returns',coalesce((select jsonb_agg(to_jsonb(t)) from public.returns t),'[]'::jsonb),
 'stockIssues',coalesce((select jsonb_agg(to_jsonb(t) order by t.issued_at desc) from public.stock_issues t),'[]'::jsonb),
 'issueItems',coalesce((select jsonb_agg(to_jsonb(t)) from public.stock_issue_items t),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.settlements t),'[]'::jsonb));
end $$;
revoke all on function public.accounting_snapshot() from public,anon;
grant execute on function public.accounting_snapshot() to authenticated;