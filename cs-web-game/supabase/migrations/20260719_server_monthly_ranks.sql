-- BrowserCS Rank Takip — hesap bazlı aylık sıralama (yeni sezon)
-- Benzersizlik: (port, month, user_id). Nickname/player_key artık kimlik değil.

-- Eski nickname sezonunu temizle (fresh start)
truncate table if exists server_monthly_ranks;

alter table if exists server_monthly_ranks
  drop constraint if exists server_monthly_ranks_port_month_player_key_key;

alter table if exists server_monthly_ranks
  drop constraint if exists server_monthly_ranks_pkey;

-- Tablo yoksa oluştur; varsa kolonları hizala
create table if not exists server_monthly_ranks (
  id uuid primary key default gen_random_uuid(),
  port integer not null,
  month text not null, -- YYYY-MM (Europe/Istanbul)
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  player_key text, -- legacy/cosmetic; equals user_id::text for upserts
  kills integer not null default 0,
  deaths integer not null default 0,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (port, month, user_id)
);

-- Mevcut tabloda user_id zorunlu + unique
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'server_monthly_ranks'
      and column_name = 'user_id'
  ) then
    -- Nickname-era satırları (user_id null) sil
    delete from server_monthly_ranks where user_id is null;

    alter table server_monthly_ranks
      alter column user_id set not null;

    -- player_key opsiyonel kalsın ama user_id ile doldur
    update server_monthly_ranks
      set player_key = user_id::text
      where player_key is null or player_key = '';
  end if;
end $$;

-- Unique (port, month, user_id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'server_monthly_ranks_port_month_user_id_key'
  ) then
    alter table server_monthly_ranks
      add constraint server_monthly_ranks_port_month_user_id_key
      unique (port, month, user_id);
  end if;
exception
  when duplicate_object then null;
  when others then
    -- constraint adı farklı olabilir; index ile garanti et
    create unique index if not exists server_monthly_ranks_port_month_user_id_uidx
      on server_monthly_ranks (port, month, user_id);
end $$;

create index if not exists server_monthly_ranks_port_month_kills_idx
  on server_monthly_ranks (port, month, kills desc);

alter table server_monthly_ranks enable row level security;

drop policy if exists "Public can view monthly ranks" on server_monthly_ranks;
create policy "Public can view monthly ranks"
  on server_monthly_ranks for select
  using (true);

-- Yazma yalnızca service_role (API) üzerinden
