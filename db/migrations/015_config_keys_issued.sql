-- When a pending config key was last handed to a launcher. One not handed out for 2 minutes and not on chain is dropped.
alter table config_keys add column issued_at timestamptz not null default now();
