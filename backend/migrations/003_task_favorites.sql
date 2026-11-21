-- Agrega favoritos sincronizados a las tareas existentes.
-- Ejecutar una vez en Supabase antes de usar la función de favoritos.
begin;

alter table public.tasks
  add column if not exists favorite boolean not null default false;

notify pgrst, 'reload schema';

commit;
