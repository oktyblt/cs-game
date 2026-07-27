-- Create a table for public profiles
create table profiles (
  id uuid references auth.users not null primary key,
  username text unique not null,
  wallet_balance integer default 0,
  is_premium boolean default false,
  -- Classic CS VIP (see migrations/20260721_vip_subscriptions.sql)
  vip_tier text not null default 'none'
    check (vip_tier in ('none', 'silver', 'gold', 'platinum')),
  vip_expires_at timestamp with time zone,
  vip_clan_tag text,
  vip_granted_at timestamp with time zone,
  vip_granted_by text,
  vip_notes text,
  -- Moderation (see migrations/20260721_user_bans.sql)
  is_banned boolean not null default false,
  banned_until timestamp with time zone,
  ban_reason text,
  admin_notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Create a table for purchased servers
create table purchased_servers (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references auth.users not null,
  name text not null,
  map text default 'de_dust2',
  max_players integer default 16,
  port integer unique, -- the port assigned by AWS manager
  status text default 'pending', -- pending, running, suspended
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table purchased_servers enable row level security;

create policy "Users can view their own servers." on purchased_servers
  for select using (auth.uid() = owner_id);

create policy "Users can insert their own servers." on purchased_servers
  for insert with check (auth.uid() = owner_id);

create policy "Users can update their own servers." on purchased_servers
  for update using (auth.uid() = owner_id);

-- ENPARA havale/EFT siparişleri
create table if not exists rental_orders (
  id uuid default gen_random_uuid() primary key,
  order_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  server_name text not null,
  map text not null default 'de_dust2',
  max_players integer not null default 16,
  amount_try numeric(10,2) not null default 350,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'provisioning', 'active', 'cancelled', 'failed')),
  purchased_server_id uuid references purchased_servers(id) on delete set null,
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table rental_orders enable row level security;

create policy "Users can view their own rental orders." on rental_orders
  for select using (auth.uid() = owner_id);

create policy "Users can insert their own rental orders." on rental_orders
  for insert with check (auth.uid() = owner_id);

-- Create a function to handle new user signups and automatically insert into profiles
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
