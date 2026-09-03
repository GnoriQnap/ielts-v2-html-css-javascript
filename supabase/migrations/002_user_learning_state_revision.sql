begin;

alter table public.user_learning_states
  add column revision bigint not null default 1;

alter table public.user_learning_states
  add constraint user_learning_states_revision_positive
  check (revision >= 1);

commit;
