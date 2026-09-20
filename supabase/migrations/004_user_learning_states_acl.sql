begin;

revoke all privileges
on table public.user_learning_states
from public;

revoke all privileges
on table public.user_learning_states
from anon;

revoke all privileges
on table public.user_learning_states
from authenticated;

grant select, insert, update
on table public.user_learning_states
to authenticated;

revoke delete
on table public.user_learning_states
from authenticated;

commit;
