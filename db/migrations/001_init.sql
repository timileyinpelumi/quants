create table launches (
  id bigserial primary key,
  mint text not null unique,
  pool text not null unique,
  quote_mint text not null,
  fee_tier_bps int not null,
  config_key text not null,
  creator text not null,
  status text not null check (status in ('live', 'graduated')),
  damm_pool text,
  damm_position text,
  damm_position_nft_account text,
  settings_version int not null,
  created_at timestamptz not null default now()
);

create table baskets (
  launch_id bigint not null references launches(id),
  reward_mint text not null,
  weight_bps int not null check (weight_bps > 0),
  primary key (launch_id, reward_mint)
);

create table stake_pools (
  launch_id bigint primary key references launches(id),
  backend text not null,
  max_penalty_bps int not null,
  spill_account text not null,
  status text not null check (status in ('pending', 'ready'))
);

create table stake_tiers (
  launch_id bigint not null references stake_pools(launch_id),
  tier_id text not null,
  lock_seconds int not null,
  multiplier_bps int not null,
  farm text,
  primary key (launch_id, tier_id)
);

create table settings (
  version serial primary key,
  data jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table distributions (
  id bigserial primary key,
  launch_id bigint not null references launches(id),
  idem_key text not null unique,
  kind text not null,
  status text not null check (status in ('pending', 'sent', 'confirmed', 'failed')),
  signature text,
  last_valid_block_height bigint,
  attempts int not null default 0,
  detail jsonb not null default '{}',
  settings_version int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index distributions_open on distributions (status) where status in ('pending', 'sent');

create table escrow (
  launch_id bigint not null references launches(id),
  bucket text not null check (bucket in ('unsplit', 'basket', 'reward', 'creator', 'treasury', 'penalty')),
  mint text not null,
  amount numeric(39, 0) not null default 0 check (amount >= 0),
  primary key (launch_id, bucket, mint)
);
