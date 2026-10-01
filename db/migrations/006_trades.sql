create table trades (
  signature text not null,
  event_index int not null,
  launch_id bigint not null references launches(id),
  venue text not null check (venue in ('curve', 'damm')),
  side text not null check (side in ('buy', 'sell')),
  trader text not null,
  base_amount numeric(40) not null,
  quote_amount numeric(40) not null,
  fee_amount numeric(40) not null,
  quote_value double precision not null,
  price double precision not null,
  quote_usd double precision,
  curve_reserve numeric(40),
  curve_threshold numeric(40),
  block_time timestamptz not null,
  slot bigint not null,
  -- chain order within an address: signatures are written oldest first, so ties inside a slot follow seq
  seq bigserial not null,
  primary key (signature, event_index)
);
create index trades_launch_time on trades (launch_id, block_time);
create index trades_launch_order on trades (launch_id, slot, seq);
create index trades_time on trades (block_time);

create table index_cursors (
  address text primary key,
  last_signature text,
  checked_at timestamptz not null default now(),
  finished boolean not null default false
);
