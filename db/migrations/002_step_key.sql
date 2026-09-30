alter table distributions add column step_key text;
update distributions set step_key = idem_key;
alter table distributions alter column step_key set not null;
create index distributions_step_key on distributions (step_key, id);
