-- Stage 4B achievement database synchronization metadata.
-- Additive migration only. Existing achievement and progress records are preserved.

alter table public.achievements
  add column if not exists icon_gray_url text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_seen_at timestamptz;

do $$
declare
  target_conname text;
  candidate_count integer := 0;
  constraint_rec record;
begin
  -- Search specifically for the original unlock timestamp constraint:
  -- CHECK (NOT is_unlocked OR unlocked_at IS NOT NULL)
  -- Ignore replacement constraint and any unrelated check constraints.
  for constraint_rec in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.user_achievements'::regclass
      and contype = 'c'
  loop
    if constraint_rec.conname <> 'user_achievements_locked_timestamp_check'
       and upper(regexp_replace(constraint_rec.def, '[\s\(\)]', '', 'g')) = 'CHECKNOTIS_UNLOCKEDORUNLOCKED_ATISNOTNULL' then
      target_conname := constraint_rec.conname;
      candidate_count := candidate_count + 1;
    end if;
  end loop;

  if candidate_count > 1 then
    raise exception 'Ambiguous check constraints found matching original unlock definition on public.user_achievements';
  end if;

  if candidate_count = 0 and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_achievements'::regclass
      and conname = 'user_achievements_locked_timestamp_check'
  ) then
    raise exception 'Original unlock timestamp constraint on public.user_achievements could not be identified safely';
  end if;

  if candidate_count = 1 then
    execute format(
      'alter table public.user_achievements drop constraint %I',
      target_conname
    );
  end if;
end;
$$;

-- Locked records must not retain stale unlock timestamps.
update public.user_achievements
set unlocked_at = null
where is_unlocked = false
  and unlocked_at is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_achievements'::regclass
      and conname = 'user_achievements_locked_timestamp_check'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_locked_timestamp_check
      check (
        (is_unlocked = false and unlocked_at is null)
        or is_unlocked = true
      );
  end if;
end;
$$;

alter table public.games
  add column if not exists achievement_schema_last_synced_at timestamptz,
  add column if not exists achievement_schema_state text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.games'::regclass
      and conname = 'games_achievement_schema_state_check'
  ) then
    alter table public.games
      add constraint games_achievement_schema_state_check
      check (
        achievement_schema_state is null
        or achievement_schema_state in ('available', 'no_achievements')
      );
  end if;
end;
$$;

alter table public.user_games
  add column if not exists achievement_last_synced_at timestamptz;
