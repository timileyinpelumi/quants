-- Transactions prepare handed to a wallet that still need server signatures (a new mint, a new config key).
-- The wallet signs first; /api/launch/cosign checks what came back against `transaction`, then signs with `signers`.
create table cosign_requests (
  id text primary key,
  transaction text not null,
  signers jsonb not null,
  need_lamports numeric,
  created_at timestamptz not null default now()
);
create index cosign_requests_created_at on cosign_requests (created_at);
