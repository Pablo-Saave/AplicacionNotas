-- Esquema inicial para un proyecto Supabase nuevo.
-- Si ya creaste estas tablas con este esquema, no vuelvas a ejecutar este archivo
-- y no borres tus tablas: la app ya tiene las columnas requeridas.

create table if not exists public.sections (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  constraint sections_id_user_id_unique unique (id, user_id)
);

create table if not exists public.lists (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  name text not null,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  constraint lists_id_user_id_unique unique (id, user_id),
  constraint lists_section_owner_fkey foreign key (section_id, user_id)
    references public.sections(id, user_id) on delete cascade
);

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id uuid not null,
  title text not null,
  note text not null default '',
  done boolean not null default false,
  due_date date,
  due_time time,
  parent_task_id uuid,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  constraint tasks_id_user_id_unique unique (id, user_id),
  constraint tasks_id_user_list_unique unique (id, user_id, list_id),
  constraint tasks_list_owner_fkey foreign key (list_id, user_id)
    references public.lists(id, user_id) on delete cascade,
  constraint tasks_parent_owner_fkey foreign key (parent_task_id, user_id, list_id)
    references public.tasks(id, user_id, list_id) on delete cascade
);

create index if not exists sections_user_updated_idx on public.sections (user_id, updated_at);
create index if not exists lists_user_updated_idx on public.lists (user_id, updated_at);
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index if not exists tasks_parent_task_id_idx on public.tasks (parent_task_id);

alter table public.sections enable row level security;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;

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

-- Los GRANT habilitan el acceso a nivel SQL; RLS sigue limitando cada fila al dueño.
revoke all privileges on public.sections, public.lists, public.tasks from anon, public;
grant select, insert, update, delete on public.sections to authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
