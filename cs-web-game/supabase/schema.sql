-- Create a table for public profiles
create table profiles (
  id uuid references auth.users not null primary key,
  username text unique not null,
  wallet_balance integer default 0,
  is_premium boolean default false,
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
