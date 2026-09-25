-- Paycheck Router initial schema.
-- Token amounts are base units in bigint. Solana addresses and signatures are base58 text.
-- Pyth feed ids are lowercase hex without 0x. RLS is on for every table with no policies,
-- so only the table owner (the service role) can read or write.

create function set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function reject_audit_log_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create type eligibility_status as enum (
  'pending',
  'eligible',
  'blocked_us',
  'blocked_country',
  'blocked_sanctions'
);

create type leg_status as enum (
  'pending',
  'waiting',
  'executing',
  'executed',
  'verified',
  'unverified',
  'expired',
  'cancelled'
);

-- Identity and access

create table users (
  id uuid primary key default gen_random_uuid(),
  privy_did text unique,
  email text,
  locale text not null default 'en',
  ref_currency text not null default 'USD',
  country_declared text,
  country_ip_last text,
  us_person boolean,
  eligibility_status eligibility_status not null default 'pending',
  tos_version text,
  risk_ack_version text,
  acked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  address text not null unique,
  kind text not null check (kind in ('embedded', 'external')),
  provider text,
  verified_at timestamptz,
  sanctions_status text not null default 'unchecked'
    check (sanctions_status in ('unchecked', 'clear', 'flagged', 'not_configured')),
  sanctions_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallets_user_id_idx on wallets (user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  wallet_address text not null,
  family_id uuid not null,
  refresh_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references sessions (id) on delete set null,
  user_agent text,
  ip_country text
);

create index sessions_family_id_idx on sessions (family_id);
create index sessions_user_id_idx on sessions (user_id);

create table auth_nonces (
  nonce text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table idempotency_keys (
  scope text not null,
  key text not null,
  request_hash text not null,
  status_code integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (scope, key)
);

create table admin_users (
  user_id uuid primary key references users (id) on delete cascade,
  role text not null check (role in ('admin', 'support', 'viewer')),
  created_at timestamptz not null default now()
);

-- Asset registry

create table assets (
  mint text primary key,
  symbol text not null,
  name text not null,
  kind text not null check (kind in ('listed_equity', 'pre_ipo')),
  issuer text not null check (issuer in ('xstocks', 'prestocks', 'other')),
  token_program text not null,
  decimals smallint not null,
  feed_id text check (feed_id ~ '^[0-9a-f]{64}$'),
  feed_id_247 text check (feed_id_247 ~ '^[0-9a-f]{64}$'),
  schedule text,
  status text not null default 'active'
    check (status in ('active', 'buys_paused', 'converting', 'delisted')),
  default_band_bps integer not null,
  max_band_bps integer not null,
  band_247_extra_bps integer not null default 0 check (band_247_extra_bps >= 0),
  conversion_target text,
  conversion_ratio_num bigint check (conversion_ratio_num > 0),
  conversion_ratio_den bigint check (conversion_ratio_den > 0),
  conversion_deadline timestamptz,
  blocked_countries text[] not null default '{}',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint assets_listed_equity_feed_check
    check (kind <> 'listed_equity' or feed_id is not null),
  constraint assets_band_247_extra_check
    check (feed_id_247 is not null or band_247_extra_bps = 0),
  constraint assets_default_band_check
    check (default_band_bps between 0 and max_band_bps),
  -- Mirrors the program's MAX_BAND_EQUITY_BPS and MAX_BAND_PREIPO_BPS.
  constraint assets_max_band_check
    check (max_band_bps <= case kind when 'listed_equity' then 300 else 1000 end),
  constraint assets_conversion_ratio_check
    check ((conversion_ratio_num is null) = (conversion_ratio_den is null))
);

create table asset_multiplier_history (
  mint text not null references assets (mint),
  effective_at timestamptz not null,
  multiplier double precision not null check (multiplier > 0),
  source_sig text,
  created_at timestamptz not null default now(),
  primary key (mint, effective_at)
);

create table attestations (
  id uuid primary key default gen_random_uuid(),
  mint text not null references assets (mint),
  mark_price_e9 bigint not null check (mark_price_e9 > 0),
  observed_at timestamptz not null,
  source text not null,
  ed25519_sig text not null,
  payload_hash text not null,
  used_in_sig text,
  created_at timestamptz not null default now()
);

create index attestations_mint_observed_at_idx on attestations (mint, observed_at);

create table price_snapshots (
  id uuid primary key default gen_random_uuid(),
  feed_id text not null check (feed_id ~ '^[0-9a-f]{64}$'),
  price bigint not null,
  conf bigint not null,
  expo integer not null,
  publish_time timestamptz not null,
  captured_at timestamptz not null default now()
);

create index price_snapshots_feed_id_publish_time_idx on price_snapshots (feed_id, publish_time);

-- Routers

create table routers (
  id uuid primary key default gen_random_uuid(),
  -- Nullable so a deletion request can pseudonymise the router by dropping the user link.
  user_id uuid references users (id) on delete set null,
  wallet_id uuid references wallets (id) on delete set null,
  owner text not null,
  router_pda text not null unique,
  authority_pda text not null,
  pay_in_ata text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  invest_bps integer not null check (invest_bps between 100 and 10000),
  min_inflow bigint not null check (min_inflow >= 1000000),
  app_threshold bigint,
  daily_cap bigint not null,
  max_wait_secs integer not null check (max_wait_secs between 0 and 1209600),
  auto_convert boolean not null,
  recorder text not null,
  payer_rule text not null default 'any' check (payer_rule in ('any', 'tagged')),
  watermark bigint,
  paycheck_seq bigint,
  onchain_snapshot jsonb,
  created_sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index routers_user_id_idx on routers (user_id);

create table router_legs (
  router_id uuid not null references routers (id) on delete cascade,
  idx smallint not null check (idx between 0 and 7),
  asset_mint text not null references assets (mint),
  weight_bps integer not null check (weight_bps between 0 and 10000),
  band_bps integer not null check (band_bps between 0 and 1000),
  enabled boolean not null default true,
  color_slot smallint not null check (color_slot between 1 and 8),
  primary key (router_id, idx)
);

create table payer_tags (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers (id) on delete cascade,
  payer_owner text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (router_id, payer_owner)
);

-- Paychecks and execution

create table inflows (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers (id),
  signature text not null,
  slot bigint not null,
  amount bigint not null check (amount > 0),
  sender_owner text,
  source text not null check (source in ('webhook', 'reconcile')),
  classification text not null default 'pending'
    check (classification in (
      'pending',
      'recorded',
      'skipped_below_minimum',
      'skipped_untagged',
      'skipped_self_transfer',
      'skipped_protocol'
    )),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (router_id, signature)
);

create table paychecks (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers (id),
  seq bigint not null,
  paycheck_pda text not null unique,
  inflow_id uuid references inflows (id),
  inflow_sig text,
  sender_owner text,
  inflow bigint not null check (inflow > 0),
  invest_total bigint not null check (invest_total <= inflow),
  recorded_sig text not null unique,
  recorded_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'open',
  closed_sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (router_id, seq)
);

create table legs (
  id uuid primary key default gen_random_uuid(),
  paycheck_id uuid not null references paychecks (id) on delete cascade,
  idx smallint not null check (idx between 0 and 7),
  asset_mint text not null references assets (mint),
  amount_in bigint not null check (amount_in > 0),
  status leg_status not null default 'pending',
  wait_reason text,
  out_amount bigint,
  fee bigint,
  ref_price_e9 bigint,
  exec_price_e9 bigint,
  premium_bps integer,
  executed_sig text unique,
  executed_at timestamptz,
  verified_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  executing_since timestamptz,
  updated_at timestamptz not null default now(),
  unique (paycheck_id, idx)
);

create index legs_status_idx on legs (status) where status in ('pending', 'waiting', 'executing');

create table attempts (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references legs (id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 0),
  kind text not null check (kind in ('simulate', 'send', 'owner_buy')),
  outcome text not null,
  program_error_code integer,
  reason text,
  quote jsonb,
  reference jsonb,
  sim_logs_key text,
  signature text,
  priority_fee_lamports bigint,
  cu_used integer,
  created_at timestamptz not null default now(),
  unique (leg_id, attempt_no, kind)
);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references legs (id) on delete cascade,
  rpc_provider text not null,
  finalized_slot bigint not null,
  owner_delta_raw bigint not null,
  owner_usdc_delta bigint not null,
  recomputed_min_out bigint not null,
  recomputed_premium_bps integer not null,
  matches boolean not null,
  diff jsonb,
  hermes_publish_time timestamptz,
  created_at timestamptz not null default now(),
  unique (leg_id, rpc_provider)
);

create table swaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  direction text not null check (direction in ('buy', 'sell')),
  asset_mint text not null references assets (mint),
  amount_in bigint not null check (amount_in > 0),
  out_amount bigint,
  band_bps integer not null check (band_bps between 0 and 1000),
  sig text unique,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index swaps_user_id_idx on swaps (user_id);

create table conversions (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers (id),
  asset_mint text not null references assets (mint),
  amount bigint not null check (amount > 0),
  target_mint text not null,
  out_amount bigint,
  sig text unique,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversions_router_id_idx on conversions (router_id);

create table fee_ledger (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid unique references legs (id),
  swap_id uuid unique references swaps (id),
  amount_usdc bigint not null check (amount_usdc >= 0),
  sig text not null,
  created_at timestamptz not null default now(),
  constraint fee_ledger_source_check check (num_nonnulls(leg_id, swap_id) = 1)
);

create table crank_txs (
  signature text primary key,
  kind text not null,
  router_id uuid references routers (id),
  fee_lamports bigint,
  priority_lamports bigint,
  cu_used integer,
  landed_via text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table submitted_txs (
  signature text primary key,
  user_id uuid references users (id) on delete set null,
  kind text not null,
  context jsonb not null default '{}',
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'finalized', 'failed', 'expired')),
  error text,
  slot bigint,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  finalized_at timestamptz
);

create index submitted_txs_user_id_idx on submitted_txs (user_id);

-- Notifications

create table notification_prefs (
  user_id uuid not null references users (id) on delete cascade,
  event text not null,
  channel text not null check (channel in ('email', 'push', 'telegram')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, event, channel)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

create table telegram_links (
  user_id uuid primary key references users (id) on delete cascade,
  chat_id bigint,
  link_code text unique,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  event text not null,
  channel text not null check (channel in ('email', 'push', 'telegram')),
  payload jsonb not null default '{}',
  status text not null,
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on notifications (user_id, created_at);

-- Partners

create table partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  payout_address text,
  revenue_share_bps integer not null default 2500
    check (revenue_share_bps between 0 and 10000),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table partner_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index partner_keys_partner_id_idx on partner_keys (partner_id);

create table partner_webhooks (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create index partner_webhooks_partner_id_idx on partner_webhooks (partner_id);

create table partner_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references partner_webhooks (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz,
  status text not null,
  response_status integer,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index partner_webhook_deliveries_due_idx on partner_webhook_deliveries (next_attempt_at)
  where delivered_at is null;

-- One table serves partner invites and personal invites from a user.
create table partner_invites (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners (id) on delete cascade,
  inviter_user_id uuid references users (id) on delete cascade,
  code text not null unique,
  preset jsonb not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint partner_invites_owner_check check (num_nonnulls(partner_id, inviter_user_id) = 1)
);

create index partner_invites_partner_id_idx on partner_invites (partner_id);

create table partner_members (
  partner_id uuid not null references partners (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  invite_id uuid references partner_invites (id) on delete set null,
  consented_at timestamptz,
  consent_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (partner_id, user_id)
);

create index partner_members_user_id_idx on partner_members (user_id);

-- Proof, status and operations

create table proof_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null check (kind in ('canonical', 'control', 'ablation', 'campaign')),
  environment text not null check (environment in ('fork', 'mainnet')),
  leg_id uuid references legs (id),
  manifest_key text,
  notes text,
  created_at timestamptz not null default now()
);

create table status_snapshots (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  status text not null,
  metrics jsonb not null default '{}',
  captured_at timestamptz not null default now()
);

create index status_snapshots_component_captured_at_idx
  on status_snapshots (component, captured_at);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null,
  actor_id text,
  action text not null,
  target text,
  details jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_audit_log_mutation();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function reject_audit_log_mutation();

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  country text,
  source text,
  created_at timestamptz not null default now()
);

create unique index waitlist_email_lower_key on waitlist (lower(email));

-- updated_at maintenance

create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger assets_set_updated_at before update on assets
  for each row execute function set_updated_at();
create trigger routers_set_updated_at before update on routers
  for each row execute function set_updated_at();
create trigger paychecks_set_updated_at before update on paychecks
  for each row execute function set_updated_at();
create trigger legs_set_updated_at before update on legs
  for each row execute function set_updated_at();
create trigger swaps_set_updated_at before update on swaps
  for each row execute function set_updated_at();
create trigger conversions_set_updated_at before update on conversions
  for each row execute function set_updated_at();
create trigger crank_txs_set_updated_at before update on crank_txs
  for each row execute function set_updated_at();
create trigger notification_prefs_set_updated_at before update on notification_prefs
  for each row execute function set_updated_at();
create trigger partners_set_updated_at before update on partners
  for each row execute function set_updated_at();

-- Row level security: deny-all for every non-owner role.

alter table users enable row level security;
alter table wallets enable row level security;
alter table sessions enable row level security;
alter table auth_nonces enable row level security;
alter table idempotency_keys enable row level security;
alter table admin_users enable row level security;
alter table assets enable row level security;
alter table asset_multiplier_history enable row level security;
alter table attestations enable row level security;
alter table price_snapshots enable row level security;
alter table routers enable row level security;
alter table router_legs enable row level security;
alter table payer_tags enable row level security;
alter table inflows enable row level security;
alter table paychecks enable row level security;
alter table legs enable row level security;
alter table attempts enable row level security;
alter table verifications enable row level security;
alter table swaps enable row level security;
alter table conversions enable row level security;
alter table fee_ledger enable row level security;
alter table crank_txs enable row level security;
alter table submitted_txs enable row level security;
alter table notification_prefs enable row level security;
alter table push_subscriptions enable row level security;
alter table telegram_links enable row level security;
alter table notifications enable row level security;
alter table partners enable row level security;
alter table partner_keys enable row level security;
alter table partner_webhooks enable row level security;
alter table partner_webhook_deliveries enable row level security;
alter table partner_invites enable row level security;
alter table partner_members enable row level security;
alter table proof_runs enable row level security;
alter table status_snapshots enable row level security;
alter table audit_log enable row level security;
alter table waitlist enable row level security;
