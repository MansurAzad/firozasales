-- Mobile Phone Distribution & Salesman Hisab app — initial schema
create type public.app_role as enum ('admin', 'salesman');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- First user becomes admin, everyone after becomes salesman.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'salesman');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text not null default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  category text not null check (category in ('smartphone', 'button_phone')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.imei_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  imei text not null unique,
  status text not null default 'in_dealer_stock'
    check (status in ('in_dealer_stock', 'with_salesman', 'sold')),
  current_salesman uuid,
  issued_at timestamptz,
  sold_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.retailers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  address text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_issues (
  id uuid primary key default gen_random_uuid(),
  salesman_id uuid not null references public.profiles(id) on delete cascade,
  issued_by uuid not null references public.profiles(id),
  note text not null default '',
  issued_at timestamptz not null default now()
);

create table public.stock_issue_items (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.stock_issues(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null default 1 check (quantity > 0),
  imei_unit_id uuid references public.imei_units(id)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  salesman_id uuid not null references public.profiles(id),
  retailer_id uuid not null references public.retailers(id),
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  note text not null default '',
  sold_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  imei_unit_id uuid references public.imei_units(id)
);

create table public.retailer_payments (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id),
  salesman_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text not null default ''
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  salesman_id uuid not null references public.profiles(id),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid references public.settlements(id) on delete cascade,
  salesman_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  deposited_at timestamptz not null default now(),
  note text not null default ''
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid references public.settlements(id) on delete cascade,
  salesman_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  quantity integer not null default 1 check (quantity > 0),
  imei_unit_id uuid references public.imei_units(id),
  is_damaged boolean not null default false,
  returned_at timestamptz not null default now()
);

-- ============= IMEI validation functions (SECURITY DEFINER) =============

create or replace function public.issue_imei(p_imei text, p_issue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.imei_units%rowtype;
  v_salesman uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admin can issue stock';
  end if;
  select * into v_unit from public.imei_units where imei = p_imei;
  if not found then
    raise exception 'Unknown IMEI: %', p_imei;
  end if;
  if v_unit.status <> 'in_dealer_stock' then
    raise exception 'IMEI % is not in dealer stock (current status: %)', p_imei, v_unit.status;
  end if;
  select salesman_id into v_salesman from public.stock_issues where id = p_issue_id;
  if v_salesman is null then
    raise exception 'Invalid stock issue';
  end if;
  update public.imei_units
    set status = 'with_salesman', current_salesman = v_salesman, issued_at = now()
    where id = v_unit.id;
  return v_unit.id;
end $$;

create or replace function public.sell_imei(p_imei text, p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.imei_units%rowtype;
  v_salesman uuid;
begin
  select salesman_id into v_salesman from public.sales where id = p_sale_id;
  if v_salesman is null then
    raise exception 'Invalid sale';
  end if;
  if v_salesman <> auth.uid() and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Not allowed to sell for another salesman';
  end if;
  select * into v_unit from public.imei_units where imei = p_imei;
  if not found then
    raise exception 'Unknown IMEI: %', p_imei;
  end if;
  if v_unit.status <> 'with_salesman' then
    raise exception 'IMEI % is not with a salesman (current status: %)', p_imei, v_unit.status;
  end if;
  if v_unit.current_salesman <> v_salesman then
    raise exception 'IMEI % belongs to a different salesman', p_imei;
  end if;
  update public.imei_units
    set status = 'sold', sold_at = now(), current_salesman = null
    where id = v_unit.id;
  return v_unit.id;
end $$;

create or replace function public.return_imei(p_imei text, p_return_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.imei_units%rowtype;
  v_salesman uuid;
begin
  select salesman_id into v_salesman from public.returns where id = p_return_id;
  if v_salesman is null then
    raise exception 'Invalid return';
  end if;
  if v_salesman <> auth.uid() and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Not allowed to return for another salesman';
  end if;
  select * into v_unit from public.imei_units where imei = p_imei;
  if not found then
    raise exception 'Unknown IMEI: %', p_imei;
  end if;
  if v_unit.status <> 'with_salesman' then
    raise exception 'IMEI % cannot be returned (current status: %)', p_imei, v_unit.status;
  end if;
  if v_unit.current_salesman <> v_salesman then
    raise exception 'IMEI % belongs to a different salesman', p_imei;
  end if;
  update public.imei_units
    set status = 'in_dealer_stock', current_salesman = null, returned_at = now()
    where id = v_unit.id;
  return v_unit.id;
end $$;

-- ============= RLS =============

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.imei_units enable row level security;
alter table public.retailers enable row level security;
alter table public.stock_issues enable row level security;
alter table public.stock_issue_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.retailer_payments enable row level security;
alter table public.settlements enable row level security;
alter table public.deposits enable row level security;
alter table public.returns enable row level security;

-- profiles
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- user_roles
create policy "user_roles: read own or admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- products: everyone signed-in reads, admin writes
create policy "products: read" on public.products
  for select to authenticated using (true);
create policy "products: admin write" on public.products
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "products: admin update" on public.products
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "products: admin delete" on public.products
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- imei_units: admin all, salesman reads own units
create policy "imei_units: read own or admin" on public.imei_units
  for select to authenticated
  using (current_salesman = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "imei_units: admin insert" on public.imei_units
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "imei_units: admin update" on public.imei_units
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "imei_units: admin delete" on public.imei_units
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- retailers: everyone reads, admin writes
create policy "retailers: read" on public.retailers
  for select to authenticated using (true);
create policy "retailers: admin insert" on public.retailers
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "retailers: admin update" on public.retailers
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "retailers: admin delete" on public.retailers
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- stock_issues
create policy "stock_issues: read own or admin" on public.stock_issues
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "stock_issues: admin insert" on public.stock_issues
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "stock_issues: admin update" on public.stock_issues
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "stock_issues: admin delete" on public.stock_issues
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "stock_issue_items: read via issue" on public.stock_issue_items
  for select to authenticated
  using (exists (
    select 1 from public.stock_issues si
    where si.id = issue_id
      and (si.salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
create policy "stock_issue_items: admin insert" on public.stock_issue_items
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "stock_issue_items: admin update" on public.stock_issue_items
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "stock_issue_items: admin delete" on public.stock_issue_items
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- sales: salesman own, admin all
create policy "sales: read own or admin" on public.sales
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "sales: insert own or admin" on public.sales
  for insert to authenticated
  with check (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "sales: update own or admin" on public.sales
  for update to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "sales: delete own or admin" on public.sales
  for delete to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "sale_items: access via sale" on public.sale_items
  for select to authenticated
  using (exists (
    select 1 from public.sales s
    where s.id = sale_id
      and (s.salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
create policy "sale_items: insert via own sale" on public.sale_items
  for insert to authenticated
  with check (exists (
    select 1 from public.sales s
    where s.id = sale_id
      and (s.salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
create policy "sale_items: update via own sale" on public.sale_items
  for update to authenticated
  using (exists (
    select 1 from public.sales s
    where s.id = sale_id
      and (s.salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
create policy "sale_items: delete via own sale" on public.sale_items
  for delete to authenticated
  using (exists (
    select 1 from public.sales s
    where s.id = sale_id
      and (s.salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));

-- retailer_payments
create policy "payments: read own or admin" on public.retailer_payments
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "payments: insert own or admin" on public.retailer_payments
  for insert to authenticated
  with check (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "payments: update own or admin" on public.retailer_payments
  for update to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "payments: delete own or admin" on public.retailer_payments
  for delete to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- settlements
create policy "settlements: read own or admin" on public.settlements
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "settlements: insert own or admin" on public.settlements
  for insert to authenticated
  with check (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "settlements: delete own or admin" on public.settlements
  for delete to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- deposits
create policy "deposits: read own or admin" on public.deposits
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "deposits: insert own or admin" on public.deposits
  for insert to authenticated
  with check (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "deposits: delete own or admin" on public.deposits
  for delete to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- returns
create policy "returns: read own or admin" on public.returns
  for select to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "returns: insert own or admin" on public.returns
  for insert to authenticated
  with check (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "returns: delete own or admin" on public.returns
  for delete to authenticated
  using (salesman_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ============= GRANTS =============

grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.imei_units to authenticated;
grant select, insert, update, delete on public.retailers to authenticated;
grant select, insert, update, delete on public.stock_issues to authenticated;
grant select, insert, update, delete on public.stock_issue_items to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.sale_items to authenticated;
grant select, insert, update, delete on public.retailer_payments to authenticated;
grant select, insert, update, delete on public.settlements to authenticated;
grant select, insert, update, delete on public.deposits to authenticated;
grant select, insert, update, delete on public.returns to authenticated;

grant all on all tables in schema public to service_role;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.issue_imei(text, uuid) to authenticated;
grant execute on function public.sell_imei(text, uuid) to authenticated;
grant execute on function public.return_imei(text, uuid) to authenticated;
