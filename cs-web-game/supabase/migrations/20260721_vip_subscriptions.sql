-- BrowserCS classic VIP subscriptions (Silver / Gold / Platinum)
-- Phase 1: profile fields + RLS (no self-upgrade)

alter table public.profiles
  add column if not exists vip_tier text not null default 'none',
  add column if not exists vip_expires_at timestamptz,
  add column if not exists vip_clan_tag text,
  add column if not exists vip_granted_at timestamptz,
  add column if not exists vip_granted_by text,
  add column if not exists vip_notes text;

-- Drop/recreate check so re-runs are safe
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_vip_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_vip_tier_check
      check (vip_tier in ('none', 'silver', 'gold', 'platinum'));
  end if;
end $$;

comment on column public.profiles.vip_tier is 'none|silver|gold|platinum — classic CS VIP';
comment on column public.profiles.vip_expires_at is 'VIP active while expires_at > now()';
comment on column public.profiles.vip_clan_tag is 'Platinum fixed short clan tag (sanitized)';

-- Users may read VIP fields (public badge / own status). Writes via service role only.
-- Existing policies already allow select for everyone and update own profile;
-- block clients from setting vip_* via a trigger.

create or replace function public.profiles_protect_vip_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.vip_tier is distinct from old.vip_tier
      or new.vip_expires_at is distinct from old.vip_expires_at
      or new.vip_clan_tag is distinct from old.vip_clan_tag
      or new.vip_granted_at is distinct from old.vip_granted_at
      or new.vip_granted_by is distinct from old.vip_granted_by
      or new.vip_notes is distinct from old.vip_notes
    then
      if auth.role() <> 'service_role' then
        new.vip_tier := old.vip_tier;
        new.vip_expires_at := old.vip_expires_at;
        new.vip_clan_tag := old.vip_clan_tag;
        new.vip_granted_at := old.vip_granted_at;
        new.vip_granted_by := old.vip_granted_by;
        new.vip_notes := old.vip_notes;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_vip on public.profiles;
create trigger profiles_protect_vip
  before update on public.profiles
  for each row execute procedure public.profiles_protect_vip_columns();
