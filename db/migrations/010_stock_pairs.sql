-- Launches paired with a tokenized stock have no basket and no staking.
alter table launches add column trading_only boolean not null default false;
alter table prepared_launches add column trading_only boolean not null default false;

-- Stocks listed by their issuers, refreshed daily; each mint is checked on chain once.
create table stock_quotes (
  mint text primary key,
  issuer text not null check (issuer in ('xstocks', 'backpack')),
  symbol text not null,
  name text not null,
  icon text,
  listed_at timestamptz not null default now(),
  checked_at timestamptz,
  ok boolean,
  problem text,
  decimals int,
  graduation double precision
);
