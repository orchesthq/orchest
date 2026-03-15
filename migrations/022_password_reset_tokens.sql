-- Extend verification token purposes to support password reset flow.

alter table user_email_verification_tokens
  drop constraint if exists user_email_verification_tokens_purpose_check;

alter table user_email_verification_tokens
  add constraint user_email_verification_tokens_purpose_check
    check (purpose in ('signup', 'invite', 'password_reset'));
