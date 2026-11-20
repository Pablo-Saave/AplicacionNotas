-- Aplicar una vez sobre el esquema existente del proyecto Supabase.
-- Verifica que listas/tareas solo puedan referenciar padres del mismo usuario.
begin;

alter table public.sections enable row level security;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sections'::regclass
      and conname = 'sections_id_user_id_unique'
  ) then
    alter table public.sections
      add constraint sections_id_user_id_unique unique (id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lists'::regclass
      and conname = 'lists_id_user_id_unique'
  ) then
    alter table public.lists
      add constraint lists_id_user_id_unique unique (id, user_id);
  end if;
end $$;

-- Replace single-column relationships with ownership-aware composite foreign keys.
alter table public.lists drop constraint if exists lists_section_id_fkey;
alter table public.tasks drop constraint if exists tasks_list_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lists'::regclass
      and conname = 'lists_section_owner_fkey'
  ) then
    alter table public.lists
      add constraint lists_section_owner_fkey
      foreign key (section_id, user_id)
      references public.sections (id, user_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_list_owner_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_list_owner_fkey
      foreign key (list_id, user_id)
      references public.lists (id, user_id) on delete cascade;
  end if;
end $$;

drop policy if exists "own sections" on public.sections;
create policy "own sections" on public.sections for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own lists" on public.lists;
create policy "own lists" on public.lists for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all privileges on public.sections, public.lists, public.tasks from anon, public;
grant select, insert, update, delete on public.sections to authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

commit;
