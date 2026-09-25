-- A verification that could not read every value (a failed readback) is still evidence: keep the
-- row with the values it did read, and let `matches` and `diff` say what went wrong.
alter table verifications
  alter column finalized_slot drop not null,
  alter column owner_delta_raw drop not null,
  alter column owner_usdc_delta drop not null,
  alter column recomputed_min_out drop not null,
  alter column recomputed_premium_bps drop not null;
