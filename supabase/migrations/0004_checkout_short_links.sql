create table if not exists checkout_short_links (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  session_id text not null,
  created_at timestamptz default now()
);

alter table checkout_short_links enable row level security;

create policy "Enable read access for all users" on checkout_short_links for select using (true);
create policy "Enable insert for service role only" on checkout_short_links for insert with check (true);
