create table prepared_launches (
  mint text primary key,
  pool text not null,
  quote_mint text not null,
  fee_tier_bps int not null,
  config_key text not null,
  creator text not null,
  basket jsonb not null,
  settings_version int not null,
  created_at timestamptz not null default now()
);
