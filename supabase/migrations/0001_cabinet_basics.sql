-- 0001_cabinet_basics.sql
-- Extends cabinet_items with additional fields and ensures RLS policies exist

create table if not exists public.cabinet_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  price numeric not null,
  image_url text,
  active boolean,
  marked boolean,
  hidden boolean,
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

alter table public.cabinet_items enable row level security;

-- RLS (idempotent)
drop policy if exists "Cabinet select own" on public.cabinet_items;
create policy "Cabinet select own" on public.cabinet_items
  for select using (auth.uid() = user_id);

drop policy if exists "Cabinet insert own" on public.cabinet_items;
create policy "Cabinet insert own" on public.cabinet_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "Cabinet update own" on public.cabinet_items;
create policy "Cabinet update own" on public.cabinet_items
  for update using (auth.uid() = user_id);

drop policy if exists "Cabinet delete own" on public.cabinet_items;
create policy "Cabinet delete own" on public.cabinet_items
  for delete using (auth.uid() = user_id);

-- Additional fields (if not present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cabinet_items' AND column_name='description'
  ) THEN
    ALTER TABLE public.cabinet_items ADD COLUMN description text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cabinet_items' AND column_name='status'
  ) THEN
    ALTER TABLE public.cabinet_items ADD COLUMN status text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cabinet_items' AND column_name='tags'
  ) THEN
    ALTER TABLE public.cabinet_items ADD COLUMN tags text[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cabinet_items' AND column_name='created_at'
  ) THEN
    ALTER TABLE public.cabinet_items ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='cabinet_items' AND indexname='idx_cabinet_user_created_at'
  ) THEN
    CREATE INDEX idx_cabinet_user_created_at
      ON public.cabinet_items (user_id, created_at DESC);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='cabinet_items' AND indexname='idx_cabinet_tags_gin'
  ) THEN
    CREATE INDEX idx_cabinet_tags_gin ON public.cabinet_items USING gin (tags);
  END IF;
END $$;

-- Optional: profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "Profiles read own" on public.profiles;
create policy "Profiles read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "Profiles upsert own" on public.profiles;
create policy "Profiles upsert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own" on public.profiles
  for update using (auth.uid() = id);
