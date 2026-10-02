-- Admin sign in moved from wallet signatures to an access code.
drop table admin_nonces;

-- id is a sha256 of the session token, so a database read does not hand out live cookies.
-- code is a fingerprint of ADMIN_CODE_HASH: rotating the code ends every session made with the old one.
create table admin_sessions (
  id text primary key,
  code text not null,
  ip text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table admin_logins (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index admin_logins_at on admin_logins (at);
create index admin_logins_ip_at on admin_logins (ip, at);
