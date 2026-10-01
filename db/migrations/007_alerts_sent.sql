create table alerts_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);
