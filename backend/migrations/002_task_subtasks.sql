-- Agrega soporte para subtareas a una instalación existente.
-- Ejecutar una sola vez en Supabase SQL Editor antes de desplegar el frontend.
begin;

alter table public.tasks add column if not exists parent_task_id uuid;

create unique index if not exists tasks_id_user_list_unique
  on public.tasks (id, user_id, list_id);
create index if not exists tasks_parent_task_id_idx
  on public.tasks (parent_task_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_parent_owner_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_parent_owner_fkey
      foreign key (parent_task_id, user_id, list_id)
      references public.tasks (id, user_id, list_id) on delete cascade;
  end if;
end $$;

commit;
