-- Single-row config table: one consultant, one config. Edited via /settings, no code changes.
create table if not exists scout_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table scout_config enable row level security; -- no policies: only the service role (server-side) can read/write
