-- 031_intake_intended_product.sql — product-scoped intake links (Herald v1)
alter table intake_sessions
  add column if not exists intended_product text;

comment on column intake_sessions.intended_product is
  'Product this intake link is scoped to (e.g. "herald"); drives the tailored form + auto product-enable on submit. NULL = generic intake.';
