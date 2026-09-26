-- Hosted fork demo: faucet grants and demo paychecks, keyed by the fork epoch they belong to.
-- A fork reset starts a new epoch, so each wallet may be funded once per fork.
create table demo_fundings (
  wallet text not null,
  epoch text not null,
  funded_at timestamptz not null default now(),
  primary key (wallet, epoch)
);

create table demo_paychecks (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  epoch text not null,
  amount bigint not null check (amount > 0),
  signature text not null unique,
  created_at timestamptz not null default now()
);

create index demo_paychecks_wallet_created_at_idx on demo_paychecks (wallet, created_at);

alter table demo_fundings enable row level security;
alter table demo_paychecks enable row level security;
