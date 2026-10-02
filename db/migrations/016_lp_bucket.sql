-- Fees claimed from a graduated launch's locked DAMM v2 LP position. They go to the treasury in full, never split.
alter table escrow drop constraint escrow_bucket_check;
alter table escrow add constraint escrow_bucket_check check (bucket in ('unsplit', 'lp', 'basket', 'reward', 'creator', 'treasury', 'penalty'));
