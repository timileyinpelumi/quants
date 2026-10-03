-- Read only admin access codes, made and revoked by the full admin. Only the argon2id hash of each code is kept.
create table admin_codes (
  id bigserial primary key,
  label text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Sessions made with ADMIN_CODE_HASH are full; sessions made with a read only code point at it, so revoking it ends them.
alter table admin_sessions add column role text not null default 'full' check (role in ('full', 'read'));
alter table admin_sessions add column code_id bigint references admin_codes (id);
create index admin_sessions_code_id on admin_sessions (code_id) where code_id is not null;
