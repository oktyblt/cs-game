-- BrowserCS: VIP abonelik ENPARA havale/EFT siparişleri
-- Not: Tablo yoksa backend otomatik olarak data/vip_orders.json'a düşer (bkz. lib/vipOrders.js),
-- bu migration çalıştırılmadan da sistem çalışır. Kalıcılık/çoklu instance için önerilir.
create table if not exists public.vip_orders (
  id uuid default gen_random_uuid() primary key,
  order_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  username text,
  tier text not null check (tier in ('silver', 'gold', 'platinum')),
  days integer not null default 30,
  amount_try numeric(10,2) not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'active', 'cancelled', 'failed')),
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists vip_orders_owner_id_idx on public.vip_orders(owner_id);
create index if not exists vip_orders_status_idx on public.vip_orders(status);
create index if not exists vip_orders_order_code_idx on public.vip_orders(order_code);

alter table public.vip_orders enable row level security;

drop policy if exists "Users can view their own vip orders." on public.vip_orders;
create policy "Users can view their own vip orders." on public.vip_orders
  for select using (auth.uid() = owner_id);

drop policy if exists "Users can insert their own vip orders." on public.vip_orders;
create policy "Users can insert their own vip orders." on public.vip_orders
  for insert with check (auth.uid() = owner_id);
