create table if not exists verified_tokens (
  mint text primary key,
  verified_at timestamptz not null default now()
);
