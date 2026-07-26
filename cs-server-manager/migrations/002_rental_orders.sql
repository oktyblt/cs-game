-- BrowserCS: ENPARA havale/EFT siparişleri
create table if not exists public.rental_orders (
  id uuid default gen_random_uuid() primary key,
  order_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  server_name text not null,
  map text not null default 'de_dust2',
  max_players integer not null default 16,
  amount_try numeric(10,2) not null default 350,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'provisioning', 'active', 'cancelled', 'failed')),
  purchased_server_id uuid references public.purchased_servers(id) on delete set null,
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists rental_orders_owner_id_idx on public.rental_orders(owner_id);
create index if not exists rental_orders_status_idx on public.rental_orders(status);
create index if not exists rental_orders_order_code_idx on public.rental_orders(order_code);

alter table public.rental_orders enable row level security;

drop policy if exists "Users can view their own rental orders." on public.rental_orders;
create policy "Users can view their own rental orders." on public.rental_orders
  for select using (auth.uid() = owner_id);

drop policy if exists "Users can insert their own rental orders." on public.rental_orders;
create policy "Users can insert their own rental orders." on public.rental_orders
  for insert with check (auth.uid() = owner_id);
