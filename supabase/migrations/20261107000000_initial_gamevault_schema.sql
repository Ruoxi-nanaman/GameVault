-- Initial GameVault relational schema and Row Level Security foundation.
-- Steam OpenID and Supabase Auth are not implemented yet. Until a verified
-- identity maps to these UUIDs, the backend must use the service-role key only
-- on the server, validate the GameVault session, and set an explicit user_id.
-- Never expose the service-role key or accept client-supplied identity as trusted.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  steam_id text unique,
  username text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  steam_app_id bigint unique not null check (steam_app_id > 0),
  title text not null,
  description text,
  cover_image text,
  header_image text,
  developer text,
  publisher text,
  release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  playtime_minutes integer not null default 0 check (playtime_minutes >= 0),
  status text not null default 'Backlog' check (status in ('Currently Playing', 'Completed', 'Backlog', 'Abandoned')),
  date_added timestamptz not null default now(),
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id)
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  achievement_api_name text not null,
  title text not null,
  description text,
  icon_url text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, achievement_api_name)
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  is_unlocked boolean not null default false,
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, achievement_id),
  check (not is_unlocked or unlocked_at is not null)
);

create table if not exists public.game_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  rating integer not null check (rating between 1 and 10),
  review_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id)
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  sync_status text not null check (sync_status in ('Pending', 'Running', 'Succeeded', 'Failed')),
  games_synced integer not null default 0 check (games_synced >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_user_games_user_id on public.user_games(user_id);
create index if not exists idx_user_games_game_id on public.user_games(game_id);
create index if not exists idx_user_games_status on public.user_games(status);
create index if not exists idx_achievements_game_id on public.achievements(game_id);
create index if not exists idx_user_achievements_user_id on public.user_achievements(user_id);
create index if not exists idx_user_achievements_achievement_id on public.user_achievements(achievement_id);
create index if not exists idx_game_reviews_game_id on public.game_reviews(game_id);
create index if not exists idx_sync_logs_user_id on public.sync_logs(user_id);
create index if not exists idx_sync_logs_started_at on public.sync_logs(started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_users_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger set_games_updated_at before update on public.games
for each row execute function public.set_updated_at();
create trigger set_user_games_updated_at before update on public.user_games
for each row execute function public.set_updated_at();
create trigger set_user_achievements_updated_at before update on public.user_achievements
for each row execute function public.set_updated_at();
create trigger set_game_reviews_updated_at before update on public.game_reviews
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.games enable row level security;
alter table public.user_games enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.game_reviews enable row level security;
alter table public.sync_logs enable row level security;

-- Shared metadata can be read without authentication.
create policy "Games are publicly readable"
on public.games for select to anon, authenticated using (true);

create policy "Achievements are publicly readable"
on public.achievements for select to anon, authenticated using (true);

-- These policies become authoritative once Supabase-authenticated user identities
-- are linked to public.users(id). They intentionally expose no private records.
create policy "Users can view their own profile"
on public.users for select to authenticated using ((select auth.uid()) = id);
create policy "Users can create their own profile"
on public.users for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users can update their own profile"
on public.users for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users can view their owned games"
on public.user_games for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add owned games"
on public.user_games for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update owned games"
on public.user_games for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can remove owned games"
on public.user_games for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view their achievement progress"
on public.user_achievements for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their achievement progress"
on public.user_achievements for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their achievement progress"
on public.user_achievements for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can remove their achievement progress"
on public.user_achievements for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view their reviews"
on public.game_reviews for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their reviews"
on public.game_reviews for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their reviews"
on public.game_reviews for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their reviews"
on public.game_reviews for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view their sync logs"
on public.sync_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their sync logs"
on public.sync_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their sync logs"
on public.sync_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
