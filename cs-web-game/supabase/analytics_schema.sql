-- Optional Supabase schema for visitor/player analytics.
-- Primary storage is file-backed on cs-server-manager (data/analytics.json).
-- Apply this only if you want DB persistence later.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  ts timestamptz not null default timezone('utc'::text, now()),
  day date not null default (timezone('utc'::text, now()))::date,
  visitor_id text not null,
  user_id uuid null references auth.users(id),
  username text null,
  nickname text null,
  is_registered boolean not null default false,
  player_key text not null,
  port integer null,
  map text null,
  session_id text null,
  ip text null,
  user_agent text null
);

create index if not exists analytics_events_day_idx on public.analytics_events (day desc);
create index if not exists analytics_events_type_idx on public.analytics_events (type);
create index if not exists analytics_events_player_idx on public.analytics_events (player_key);

alter table public.analytics_events enable row level security;

-- Backend service role only; no public client access.
create policy "Service role full access analytics_events"
  on public.analytics_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
