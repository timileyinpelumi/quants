create table admin_nonces (
  jti text primary key,
  used_at timestamptz not null default now()
);
