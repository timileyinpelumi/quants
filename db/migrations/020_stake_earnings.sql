-- Staker earnings are booked here and paid by the keeper once a period is approved; farms no longer emit rewards.
alter table escrow drop constraint escrow_bucket_check;
alter table escrow add constraint escrow_bucket_check check (bucket in ('unsplit', 'lp', 'basket', 'reward', 'owed', 'creator', 'treasury', 'penalty'));

alter table stake_pools add column accrued_at timestamptz;

create table stake_periods (
  id bigserial primary key,
  launch_id bigint not null references launches(id),
  tier_id text not null,
  owner text not null,
  stake numeric(40,0) not null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('accruing', 'due', 'approved', 'paid', 'rejected', 'forfeited')),
  decided_by text,
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index stake_periods_open on stake_periods (launch_id, tier_id, owner) where status = 'accruing';
create index stake_periods_status on stake_periods (status);

create table stake_earnings (
  period_id bigint not null references stake_periods(id),
  mint text not null,
  amount numeric(40,0) not null default 0 check (amount >= 0),
  primary key (period_id, mint)
);
