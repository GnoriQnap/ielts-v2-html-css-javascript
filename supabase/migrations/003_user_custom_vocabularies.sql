begin;

create table if not exists public.user_custom_vocabularies (
  user_id uuid primary key
    references auth.users (id)
    on delete cascade,
  vocabulary jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint user_custom_vocabularies_vocabulary_must_be_object
    check (jsonb_typeof(vocabulary) = 'object'),
  constraint user_custom_vocabularies_revision_positive
    check (revision >= 1)
);

comment on table public.user_custom_vocabularies is
  'One canonical Custom Vocabulary Snapshot V1 per authenticated user.';
comment on column public.user_custom_vocabularies.vocabulary is
  'Custom-only vocabulary snapshot; excludes the official baseline and learning state.';

drop trigger if exists set_user_custom_vocabularies_updated_at
  on public.user_custom_vocabularies;

create trigger set_user_custom_vocabularies_updated_at
before insert or update on public.user_custom_vocabularies
for each row
execute function public.set_user_learning_states_updated_at();

alter table public.user_custom_vocabularies enable row level security;

drop policy if exists "Users can read their own custom vocabulary"
  on public.user_custom_vocabularies;
create policy "Users can read their own custom vocabulary"
  on public.user_custom_vocabularies
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own custom vocabulary"
  on public.user_custom_vocabularies;
create policy "Users can insert their own custom vocabulary"
  on public.user_custom_vocabularies
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own custom vocabulary"
  on public.user_custom_vocabularies;
create policy "Users can update their own custom vocabulary"
  on public.user_custom_vocabularies
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_custom_vocabularies from public;
revoke all on table public.user_custom_vocabularies from anon;
revoke all on table public.user_custom_vocabularies from authenticated;
grant select, insert, update on table public.user_custom_vocabularies to authenticated;
revoke delete on table public.user_custom_vocabularies from authenticated;

commit;
