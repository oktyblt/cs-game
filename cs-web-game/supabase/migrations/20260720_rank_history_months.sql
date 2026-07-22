-- BrowserCS Rank — hesap bazlı + geçmiş aylık sezonlar
-- Supabase SQL Editor'da çalıştırın.
-- Benzersizlik: (port, month, user_id). Her ay ayrı satır → geçmiş korunur.

-- 1) Tablo (yoksa oluştur)
create table if not exists public.server_monthly_ranks (
  id uuid primary key default gen_random_uuid(),
  port integer not null,
  month text not null, -- YYYY-MM (Europe/Istanbul)
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  player_key text, -- legacy; genelde user_id::text
  kills integer not null default 0 check (kills >= 0),
  deaths integer not null default 0 check (deaths >= 0),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- 2) Eski nickname unique'ini kaldır
alter table public.server_monthly_ranks
  drop constraint if exists server_monthly_ranks_port_month_player_key_key;

-- 3) Nickname-era (user_id null) satırları temizle — hesap sezonu
delete from public.server_monthly_ranks where user_id is null;

-- 4) user_id zorunlu
do $$
begin
  alter table public.server_monthly_ranks
    alter column user_id set not null;
exception
  when others then null;
end $$;

-- 5) player_key'i user_id ile hizala (opsiyonel uyumluluk)
update public.server_monthly_ranks
set player_key = user_id::text
where player_key is distinct from user_id::text
   or player_key is null;

-- 6) Hesap bazlı unique — aynı ayda aynı hesap tek satır; geçmiş aylar ayrı kalır
create unique index if not exists server_monthly_ranks_port_month_user_id_uidx
  on public.server_monthly_ranks (port, month, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'server_monthly_ranks_port_month_user_id_key'
  ) then
    alter table public.server_monthly_ranks
      add constraint server_monthly_ranks_port_month_user_id_key
      unique using index server_monthly_ranks_port_month_user_id_uidx;
  end if;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- 7) Geçmiş sorguları için indeksler (yıl/ay tarama)
create index if not exists server_monthly_ranks_port_month_kills_idx
  on public.server_monthly_ranks (port, month, kills desc);

create index if not exists server_monthly_ranks_month_idx
  on public.server_monthly_ranks (month desc);

create index if not exists server_monthly_ranks_port_month_idx
  on public.server_monthly_ranks (port, month desc);

-- 8) Yıl/ay geçmişi için yardımcı view (UI / API)
create or replace view public.server_rank_history_months as
select
  port,
  month,
  left(month, 4) as year,
  right(month, 2) as month_num,
  count(*)::int as players,
  coalesce(sum(kills), 0)::int as total_kills,
  max(updated_at) as updated_at
from public.server_monthly_ranks
where month ~ '^[0-9]{4}-[0-9]{2}$'
  and user_id is not null
group by port, month
order by month desc;

-- 9) RLS — herkes geçmişi okuyabilir; yazma yalnızca service_role
alter table public.server_monthly_ranks enable row level security;

drop policy if exists "Public can view monthly ranks" on public.server_monthly_ranks;
create policy "Public can view monthly ranks"
  on public.server_monthly_ranks
  for select
  using (true);

-- View için grant (anon/authenticated okuyabilsin)
grant select on public.server_rank_history_months to anon, authenticated, service_role;
grant select on public.server_monthly_ranks to anon, authenticated, service_role;

-- Örnek sorgular:
-- Belirli sunucu + ay Top 20:
--   select display_name, kills, deaths
--   from server_monthly_ranks
--   where port = 27015 and month = '2026-07'
--   order by kills desc, deaths asc
--   limit 20;
--
-- Bir sunucunun yılları:
--   select distinct year from server_rank_history_months where port = 27015 order by year desc;
--
-- Bir yılın ayları:
--   select month, players, total_kills
--   from server_rank_history_months
--   where port = 27015 and year = '2026'
--   order by month desc;
