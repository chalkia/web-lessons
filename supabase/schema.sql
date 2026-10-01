-- =====================================================
-- Πλατφόρμα εξ αποστάσεως ιδιαιτέρων — σχήμα βάσης
-- Τρέξε ΟΛΟ αυτό το αρχείο στο Supabase > SQL Editor.
-- =====================================================

-- ---------- Πίνακες ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  -- pending = νέος χρήστης χωρίς ρόλο, περιμένει τον διαχειριστή
  role text not null default 'pending'
    check (role in ('pending','admin','main_teacher','assistant_teacher','student','parent')),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  grade text,
  notes text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Προσκλήσεις: ο εκπαιδευτικός δηλώνει email και σχέση.
-- Όταν κάποιος εγγραφεί με αυτό το email, συνδέεται αυτόματα.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  relation text not null check (relation in ('student','parent','assistant_teacher')),
  created_at timestamptz not null default now(),
  unique (email, student_id, relation)
);

create table if not exists public.student_parents (
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  primary key (student_id, parent_id)
);

create table if not exists public.student_assistants (
  student_id uuid not null references public.students(id) on delete cascade,
  assistant_id uuid not null references public.profiles(id) on delete cascade,
  primary key (student_id, assistant_id)
);

-- Ημερολόγιο + παρουσιολόγιο
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned'
    check (status in ('planned','done','cancelled','absent')),
  meeting_url text,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists lessons_student_idx on public.lessons(student_id, starts_at);
create index if not exists lessons_teacher_idx on public.lessons(teacher_id, starts_at);

-- Προσωπικό ημερολόγιο (επόμενες υποχρεώσεις) κάθε χρήστη
create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Βοηθητικές συναρτήσεις ----------
-- security definer: αποφεύγουν ατέρμονη αναδρομή στους κανόνες RLS.

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Βλέπει ο τρέχων χρήστης αυτόν τον μαθητή;
create or replace function public.can_see_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.students s where s.id = sid and s.teacher_id = auth.uid())
    or exists (select 1 from public.students s where s.id = sid and s.user_id = auth.uid())
    or exists (select 1 from public.student_parents p where p.student_id = sid and p.parent_id = auth.uid())
    or exists (select 1 from public.student_assistants a where a.student_id = sid and a.assistant_id = auth.uid())
$$;

-- Βλέπει ο τρέχων χρήστης αυτό το προφίλ;
create or replace function public.can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pid = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.students s
      where s.teacher_id = auth.uid()
        and (s.user_id = pid
          or exists (select 1 from public.student_parents p where p.student_id = s.id and p.parent_id = pid)
          or exists (select 1 from public.student_assistants a where a.student_id = s.id and a.assistant_id = pid))
    )
$$;

-- ---------- Αυτόματη δημιουργία προφίλ + σύνδεση από προσκλήσεις ----------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv record;
  new_role text := 'pending';
begin
  -- Ο ρόλος προκύπτει ΜΟΝΟ από πρόσκληση, ποτέ από αυτό που δηλώνει ο χρήστης.
  select relation into inv from public.invites
    where lower(email) = lower(new.email)
    order by created_at limit 1;
  if found then
    new_role := inv.relation;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new_role);

  insert into public.student_parents (student_id, parent_id)
    select student_id, new.id from public.invites
    where lower(email) = lower(new.email) and relation = 'parent'
    on conflict do nothing;

  insert into public.student_assistants (student_id, assistant_id)
    select student_id, new.id from public.invites
    where lower(email) = lower(new.email) and relation = 'assistant_teacher'
    on conflict do nothing;

  update public.students s set user_id = new.id
    from public.invites i
    where i.student_id = s.id and i.relation = 'student'
      and lower(i.email) = lower(new.email) and s.user_id is null;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Κανόνες πρόσβασης (RLS) ----------

alter table public.profiles          enable row level security;
alter table public.students          enable row level security;
alter table public.invites           enable row level security;
alter table public.student_parents   enable row level security;
alter table public.student_assistants enable row level security;
alter table public.lessons           enable row level security;
alter table public.personal_events   enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (public.can_see_profile(id));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_self_name on public.profiles;
-- Ο χρήστης αλλάζει μόνο το όνομά του, όχι τον ρόλο (προστασία στο trigger πιο κάτω).
create policy profiles_self_name on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null όταν τρέχει το SQL Editor του Supabase (ή service role).
  -- Το επιτρέπουμε ώστε να ορίζεται ο πρώτος διαχειριστής (διόρθωση 2026-10-01:
  -- χωρίς αυτό το update του πρώτου admin απέρριπτε το "Μόνο ο διαχειριστής αλλάζει ρόλους").
  -- Οι χρήστες της σελίδας έχουν πάντα auth.uid(), άρα δεν επηρεάζονται.
  if auth.uid() is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Μόνο ο διαχειριστής αλλάζει ρόλους';
  end if;
  return new;
end $$;
drop trigger if exists protect_role_trg on public.profiles;
create trigger protect_role_trg before update on public.profiles
  for each row execute function public.protect_role();

-- students
drop policy if exists students_select on public.students;
create policy students_select on public.students for select
  using (public.can_see_student(id));
drop policy if exists students_write on public.students;
create policy students_write on public.students for all
  using (public.is_admin() or (teacher_id = auth.uid() and public.my_role() = 'main_teacher'))
  with check (public.is_admin() or (teacher_id = auth.uid() and public.my_role() = 'main_teacher'));

-- invites: μόνο ο κύριος εκπαιδευτικός του μαθητή και ο διαχειριστής
drop policy if exists invites_all on public.invites;
create policy invites_all on public.invites for all
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- συνδέσεις γονέων / βοηθών
drop policy if exists sp_select on public.student_parents;
create policy sp_select on public.student_parents for select
  using (public.can_see_student(student_id));
drop policy if exists sp_write on public.student_parents;
create policy sp_write on public.student_parents for all
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists sa_select on public.student_assistants;
create policy sa_select on public.student_assistants for select
  using (public.can_see_student(student_id));
drop policy if exists sa_write on public.student_assistants;
create policy sa_write on public.student_assistants for all
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- lessons: βλέπουν όσοι βλέπουν τον μαθητή, γράφει μόνο ο κύριος εκπαιδευτικός
drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select
  using (public.can_see_student(student_id));
drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons for all
  using (public.is_admin() or teacher_id = auth.uid())
  with check (
    public.is_admin()
    or (teacher_id = auth.uid()
        and exists (select 1 from public.students s
                    where s.id = student_id and s.teacher_id = auth.uid()))
  );

-- personal_events: μόνο ο ιδιοκτήτης
drop policy if exists pe_all on public.personal_events;
create policy pe_all on public.personal_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================
-- ΠΡΩΤΟΣ ΔΙΑΧΕΙΡΙΣΤΗΣ
-- 1) Εγγράψου στην εφαρμογή με το email σου.
-- 2) Τρέξε (με το δικό σου email):
--    update public.profiles set role = 'admin' where email = 'το-email-σου@example.com';
-- =====================================================
