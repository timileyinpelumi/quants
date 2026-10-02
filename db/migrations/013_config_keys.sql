-- DBC config keys by pair, fee and graduation threshold (quote base units). A launch that needs one that does not
-- exist creates it in its own setup transaction. The first prepare claims the row, so concurrent launches on the
-- same pair share one address; `secret` is the config keypair, kept only until the account is seen on chain.
create table config_keys (
  quote_mint text not null,
  fee_bps int not null,
  threshold numeric not null,
  address text not null unique,
  secret jsonb,
  status text not null default 'pending' check (status in ('pending', 'live')),
  created_at timestamptz not null default now(),
  primary key (quote_mint, fee_bps, threshold)
);

-- Platform accounts quants creates on demand, such as the Kamino global config.
create table platform_accounts (
  name text primary key,
  address text not null,
  created_at timestamptz not null default now()
);
