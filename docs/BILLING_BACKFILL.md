# Billing Backfill Notes

`015_usd_billing_foundations.sql` adds pricing snapshot columns to `token_usage_events`.
Existing rows keep those fields `NULL` by design to preserve history.

## Option A (recommended): keep historical rows unpriced

- Leave `input_cost_usd_micros`, `output_cost_usd_micros`, `total_cost_usd_micros`,
  `markup_multiplier_snapshot`, `billable_usd_micros`, and `pricing_version` as `NULL`
  for pre-pricing data.
- Start charging only for events created after rate card configuration.

## Option B: zero-fill historical rows

If you prefer to make old rows explicit non-billable:

```sql
update token_usage_events
set
  input_cost_usd_micros = 0,
  output_cost_usd_micros = 0,
  total_cost_usd_micros = 0,
  markup_multiplier_snapshot = 1.0000,
  billable_usd_micros = 0,
  pricing_version = coalesce(pricing_version, 'backfill_zero')
where billable_usd_micros is null;
```

## Option C: repricing historical rows

Only do this if you have stable historical rates and a clear policy. The service currently
prices rows at write time (snapshot billing), so repricing old rows should be treated as a
one-off operation with an auditable migration script.
