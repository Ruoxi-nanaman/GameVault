-- Stage 3C unified Steam library source evidence.
-- This migration is additive and has not been applied to Supabase.

create table if not exists public.steam_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  overall_status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint steam_sync_runs_overall_status_check
    check (overall_status in ('running', 'success', 'partial', 'failed'))
);

create table if not exists public.steam_sync_source_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.steam_sync_runs(id) on delete cascade,
  source_type text not null,
  status text not null,
  returned_count integer not null default 0 check (returned_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  unique (run_id, source_type),
  constraint steam_sync_source_results_source_type_check
    check (source_type in ('owned', 'family_shared', 'recently_played')),
  constraint steam_sync_source_results_status_check
    check (status in (
      'pending',
      'success_records',
      'success_empty',
      'request_failed',
      'unavailable',
      'invalid_response',
      'rate_limited',
      'unauthorized'
    ))
);

create table if not exists public.user_game_sources (
  user_id uuid not null references public.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  source_type text not null,
  evidence_provenance text not null,
  evidence_created_at timestamptz not null default now(),
  first_seen_at timestamptz,
  last_observed_at timestamptz,
  last_confirmed_at timestamptz,
  last_confirmation_run_id uuid references public.steam_sync_runs(id) on delete set null,
  freshness_status text not null,
  recent_playtime_minutes integer,
  recent_playtime_last_observed_at timestamptz,
  primary key (user_id, game_id, source_type),
  constraint user_game_sources_source_type_check
    check (source_type in ('owned', 'family_shared', 'recently_played')),
  constraint user_game_sources_provenance_check
    check (evidence_provenance in ('migration_backfill', 'steam_sync')),
  constraint user_game_sources_freshness_check
    check (freshness_status in ('confirmed', 'stale', 'unverified')),
  constraint user_game_sources_recent_playtime_check
    check (recent_playtime_minutes is null or recent_playtime_minutes >= 0)
);

create index if not exists idx_steam_sync_runs_user_started
  on public.steam_sync_runs(user_id, started_at desc);
create index if not exists idx_steam_sync_source_results_run
  on public.steam_sync_source_results(run_id, source_type);
create index if not exists idx_user_game_sources_user
  on public.user_game_sources(user_id);
create index if not exists idx_user_game_sources_game
  on public.user_game_sources(game_id);
create index if not exists idx_user_game_sources_user_source_freshness
  on public.user_game_sources(user_id, source_type, freshness_status);

-- user_games already contains last_played_at in the current GameVault schema.
-- This guard documents it as compatible without changing the canonical table.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_games'
      and column_name = 'last_played_at'
  ) then
    alter table public.user_games
      add column last_played_at timestamptz;
  end if;
end;
$$;

-- Existing standard-owned synchronization relationships become historical,
-- unverified migration evidence. Observation timestamps remain NULL because
-- migration execution is not a Steam confirmation.
insert into public.user_game_sources (
  user_id,
  game_id,
  source_type,
  evidence_provenance,
  first_seen_at,
  last_observed_at,
  last_confirmed_at,
  last_confirmation_run_id,
  freshness_status,
  recent_playtime_minutes,
  recent_playtime_last_observed_at
)
select
  ug.user_id,
  ug.game_id,
  'owned',
  'migration_backfill',
  null,
  null,
  null,
  null,
  'unverified',
  null,
  null
from public.user_games ug
on conflict (user_id, game_id, source_type) do nothing;

alter table public.steam_sync_runs enable row level security;
alter table public.steam_sync_source_results enable row level security;
alter table public.user_game_sources enable row level security;

create policy "Users can view their sync runs"
on public.steam_sync_runs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their source results"
on public.steam_sync_source_results for select to authenticated
using (
  exists (
    select 1
    from public.steam_sync_runs as sync_run
    where sync_run.id = steam_sync_source_results.run_id
      and sync_run.user_id = (select auth.uid())
  )
);

create policy "Users can view their game source evidence"
on public.user_game_sources for select to authenticated
using ((select auth.uid()) = user_id);
