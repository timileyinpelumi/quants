-- Collected early exit penalties wait here until an admin approves the burn.
create table burn_requests (
  id bigserial primary key,
  launch_id bigint not null references launches(id),
  mint text not null,
  amount numeric(40,0) not null check (amount > 0),
  status text not null check (status in ('pending', 'approved', 'burned')),
  decided_by text,
  decided_at timestamptz,
  burned_at timestamptz,
  created_at timestamptz not null default now()
);
create index burn_requests_open on burn_requests (launch_id) where status <> 'burned';
