-- Admin analytics: range reads over the ledger and trades, keeper run history and cookieless page views.
create index distributions_confirmed_kind_time on distributions (kind, updated_at) where status = 'confirmed';
create index distributions_failed_time on distributions (updated_at) where status = 'failed';
create index trades_time_launch on trades (block_time, launch_id);

alter table launches add column graduated_at timestamptz;
update launches l set graduated_at = coalesce(
  (select min(t.block_time) from trades t where t.launch_id = l.id and t.venue = 'damm'), l.created_at)
where l.status = 'graduated';
create index launches_graduated_at on launches (graduated_at) where graduated_at is not null;

alter table stake_pools add column opened_at timestamptz;
update stake_pools p set opened_at = coalesce(
  (select max(d.updated_at) from distributions d where d.launch_id = p.launch_id and d.kind = 'configure_farm' and d.status = 'confirmed'),
  (select created_at from launches where id = p.launch_id))
where p.status = 'ready';

create table keeper_runs (
  id bigserial primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  launches int not null default 0,
  errors int not null default 0,
  -- the first launch error, or the reason the whole run failed
  error text,
  fatal boolean not null default false
);
create index keeper_runs_started on keeper_runs (started_at);

-- One salt per UTC day. Older salts are deleted, so a visitor hash cannot be linked across days.
create table analytics_salts (
  day date primary key,
  salt bytea not null
);

-- visitor is sha256(day salt + ip + user agent); no IP, user agent or cookie is stored.
create table page_views (
  at timestamptz not null default now(),
  path text not null,
  visitor text not null,
  referrer text
);
create index page_views_at on page_views (at);
