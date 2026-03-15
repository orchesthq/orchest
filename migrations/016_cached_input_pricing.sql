-- Add cached input pricing support.

alter table token_usage_events
  add column if not exists cached_input_cost_usd_micros bigint;

alter table token_usage_events
  add constraint token_usage_events_cached_input_cost_usd_micros_non_negative
    check (cached_input_cost_usd_micros is null or cached_input_cost_usd_micros >= 0);

alter table llm_pricing_rates
  drop constraint if exists llm_pricing_rates_token_type_check;

alter table llm_pricing_rates
  add constraint llm_pricing_rates_token_type_check
    check (token_type in ('input', 'cached_input', 'output'));
