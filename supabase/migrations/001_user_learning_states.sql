begin;

create table if not exists public.user_learning_states (
  user_id uuid primary key
    references auth.users (id)
    on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint user_learning_states_state_must_be_object
    check (jsonb_typeof(state) = 'object')
);

comment on table public.user_learning_states is
  'One normalized learning-state snapshot per authenticated user.';
comment on column public.user_learning_states.state is
  'Learning-only application state; excludes vocabulary data and authentication credentials.';

create or replace function public.set_user_learning_states_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_learning_states_updated_at
  on public.user_learning_states;

create trigger set_user_learning_states_updated_at
before insert or update on public.user_learning_states
for each row
execute function public.set_user_learning_states_updated_at();

alter table public.user_learning_states enable row level security;

drop policy if exists "Users can read their own learning state"
  on public.user_learning_states;
create policy "Users can read their own learning state"
  on public.user_learning_states
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own learning state"
  on public.user_learning_states;
create policy "Users can insert their own learning state"
  on public.user_learning_states
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own learning state"
  on public.user_learning_states;
create policy "Users can update their own learning state"
  on public.user_learning_states
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_learning_states from public;
revoke all on table public.user_learning_states from anon;
grant select, insert, update on table public.user_learning_states to authenticated;
revoke delete on table public.user_learning_states from authenticated;

revoke all on function public.set_user_learning_states_updated_at() from public;
revoke all on function public.set_user_learning_states_updated_at() from anon;
revoke all on function public.set_user_learning_states_updated_at() from authenticated;

commit;
