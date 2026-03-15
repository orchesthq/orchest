-- Default client markup multiplier to 1.3x.
-- Applies to newly inserted billing profiles.

alter table client_billing_profiles
  alter column markup_multiplier set default 1.3000;
