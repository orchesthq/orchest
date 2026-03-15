-- Optional monthly budget per client for "x% used" UX.
-- Null means: derive budget from current-month credited top-ups.

alter table client_billing_profiles
  add column if not exists monthly_budget_usd_micros bigint
  check (monthly_budget_usd_micros is null or monthly_budget_usd_micros >= 0);
