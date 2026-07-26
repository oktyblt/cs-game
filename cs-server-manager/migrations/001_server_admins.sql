-- BrowserCS: sunucu bazlı adminler (kayıtlı kullanıcı + AMXX eşlemesi)
create table if not exists public.server_admins (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.purchased_servers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  game_name text not null,
  amx_password text not null default '',
  flags text not null default 'abcdefghijklmnopqrstu',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint server_admins_game_name_nonempty check (char_length(trim(game_name)) > 0)
);

create unique index if not exists server_admins_server_user_uidx
  on public.server_admins (server_id, user_id)
  where user_id is not null;

create unique index if not exists server_admins_server_name_uidx
  on public.server_admins (server_id, lower(game_name));

create index if not exists server_admins_user_id_idx on public.server_admins (user_id);
create index if not exists server_admins_server_id_idx on public.server_admins (server_id);

alter table public.server_admins enable row level security;

-- Owner: kendi sunucusunun adminlerini görür (şifre dahil — sadece owner UI)
drop policy if exists server_admins_owner_select on public.server_admins;
create policy server_admins_owner_select on public.server_admins
  for select to authenticated
  using (
    exists (
      select 1 from public.purchased_servers s
      where s.id = server_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists server_admins_owner_write on public.server_admins;
create policy server_admins_owner_write on public.server_admins
  for all to authenticated
  using (
    exists (
      select 1 from public.purchased_servers s
      where s.id = server_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.purchased_servers s
      where s.id = server_id and s.owner_id = auth.uid()
    )
  );

-- Kayıtlı oyuncu: sadece KENDİ satırını görür (join'de _pw almak için)
drop policy if exists server_admins_self_select on public.server_admins;
create policy server_admins_self_select on public.server_admins
  for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.server_admins to authenticated;
grant select, insert, update, delete on public.server_admins to service_role;

-- Mevcut purchased_servers.admin_name / admin_password → ilk seed
insert into public.server_admins (server_id, user_id, game_name, amx_password, flags, created_by)
select
  s.id,
  null,
  trim(s.admin_name),
  coalesce(s.admin_password, ''),
  'abcdefghijklmnopqrstu',
  s.owner_id
from public.purchased_servers s
where coalesce(trim(s.admin_name), '') <> ''
on conflict do nothing;
