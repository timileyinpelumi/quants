alter table stake_pools
  add column rent_lamports bigint,
  add column basket_value_lamports bigint not null default 0;

-- The farm rent comes out of the stakers' share once per launch.
create unique index distributions_rent_once on distributions (launch_id) where kind = 'rent' and status = 'confirmed';
