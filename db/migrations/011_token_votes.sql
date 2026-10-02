-- One vote per voter per token: 1 up, -1 down. Clearing a vote deletes the row.
create table token_votes (
  mint text not null,
  voter text not null,
  vote smallint not null check (vote in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (mint, voter)
);
