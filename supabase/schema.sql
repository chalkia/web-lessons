-- =====================================================
-- Πλατφόρμα εξ αποστάσεως ιδιαιτέρων — σχήμα βάσης
-- Τρέξε ΟΛΟ αυτό το αρχείο στο Supabase > SQL Editor.
-- Μπορεί να τρέξει ξανά και ξανά: αναβαθμίζει και μια υπάρχουσα βάση.
--
-- ΜΟΝΤΕΛΟ ΡΟΛΩΝ (από 2026-10-01)
-- Ο λογαριασμός έχει ΕΝΑ από τρία είδη: admin, teacher, student ("Μαθητής / γονέας").
-- Ο γονέας και ο βοηθός ΔΕΝ είναι είδη λογαριασμού. Είναι σχέσεις ανά μαθητή
-- (πίνακες student_parents, student_assistants). Ο ίδιος εκπαιδευτικός έχει δικούς του
-- μαθητές και ταυτόχρονα είναι βοηθός σε μαθητές άλλων.
-- =====================================================

-- ---------- Πίνακες ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'student'
    check (role in ('admin','teacher','student')),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  grade text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Ιδιωτικές σημειώσεις του εκπαιδευτικού για τον μαθητή.
-- Χωριστός πίνακας: οι κανόνες RLS δουλεύουν ανά γραμμή, όχι ανά στήλη. Στη στήλη
-- students.notes τις έβλεπαν και ο μαθητής, οι γονείς και οι βοηθοί (διόρθωση 2026-10-01).
create table if not exists public.student_notes (
  student_id uuid primary key references public.students(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now()
);

-- Προσκλήσεις για email που δεν έχει ακόμη λογαριασμό.
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
  chosen text := coalesce(new.raw_user_meta_data->>'account_type', 'student');
begin
  -- Επιτρέπονται μόνο teacher ή student. Ο admin ορίζεται ΜΟΝΟ από τη βάση.
  if chosen not in ('teacher','student') then
    chosen := 'student';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          chosen);

  -- Γονέας
  insert into public.student_parents (student_id, parent_id)
    select student_id, new.id from public.invites
    where lower(email) = lower(new.email) and relation = 'parent'
    on conflict do nothing;
  delete from public.invites
    where lower(email) = lower(new.email) and relation = 'parent';

  -- Μαθητής (μόνο αν ο μαθητής δεν έχει ήδη λογαριασμό)
  update public.students s set user_id = new.id
    from public.invites i
    where i.student_id = s.id and i.relation = 'student'
      and lower(i.email) = lower(new.email) and s.user_id is null;
  delete from public.invites i
    where lower(i.email) = lower(new.email) and i.relation = 'student'
      and exists (select 1 from public.students s where s.id = i.student_id and s.user_id = new.id);

  -- Βοηθός: μόνο αν επέλεξε λογαριασμό εκπαιδευτικού
  if chosen = 'teacher' then
    insert into public.student_assistants (student_id, assistant_id)
      select student_id, new.id from public.invites
      where lower(email) = lower(new.email) and relation = 'assistant_teacher'
      on conflict do nothing;
    delete from public.invites
      where lower(email) = lower(new.email) and relation = 'assistant_teacher';
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Πρόσκληση / σύνδεση ----------
-- Ο εκπαιδευτικός του μαθητή (ή ο διαχειριστής) δίνει email και σχέση.
-- Αν υπάρχει ήδη λογαριασμός με αυτό το email, η σύνδεση γίνεται αμέσως.
-- Αλλιώς καταχωρείται πρόσκληση και εφαρμόζεται όταν γίνει εγγραφή.
-- Επιστρέφει πάντα 'ok': δεν αποκαλύπτουμε αν ένα email έχει λογαριασμό.
create or replace function public.add_access(sid uuid, target_email text, rel text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  em text := lower(trim(target_email));
  uid uuid;
  urole text;
begin
  if rel not in ('student','parent','assistant_teacher') then
    raise exception 'Άκυρη σχέση';
  end if;

  select teacher_id into owner_id from public.students where id = sid;
  if owner_id is null then
    raise exception 'Δεν βρέθηκε ο μαθητής';
  end if;
  if not (public.is_admin() or owner_id = auth.uid()) then
    raise exception 'Δεν έχεις δικαίωμα σε αυτόν τον μαθητή';
  end if;

  -- Το email το παίρνουμε από το auth.users (αυθεντικό), όχι από το profiles.
  select u.id, p.role into uid, urole
    from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = em limit 1;

  if uid is not null then
    if rel = 'parent' then
      insert into public.student_parents (student_id, parent_id) values (sid, uid)
        on conflict do nothing;
      return 'ok';
    elsif rel = 'student'
      and exists (select 1 from public.students where id = sid and user_id is null) then
      update public.students set user_id = uid where id = sid;
      return 'ok';
    elsif rel = 'assistant_teacher' and urole in ('teacher','admin') and uid <> owner_id then
      insert into public.student_assistants (student_id, assistant_id) values (sid, uid)
        on conflict do nothing;
      return 'ok';
    end if;
  end if;

  -- Δεν υπάρχει λογαριασμός (ή δεν ταιριάζει): μένει πρόσκληση σε αναμονή.
  insert into public.invites (email, student_id, relation) values (em, sid, rel)
    on conflict do nothing;
  return 'ok';
end $$;

revoke execute on function public.add_access(uuid, text, text) from public;
grant execute on function public.add_access(uuid, text, text) to authenticated;

-- ---------- Κανόνες πρόσβασης (RLS) ----------

alter table public.profiles           enable row level security;
alter table public.students           enable row level security;
alter table public.student_notes      enable row level security;
alter table public.invites            enable row level security;
alter table public.student_parents    enable row level security;
alter table public.student_assistants enable row level security;
alter table public.lessons            enable row level security;
alter table public.personal_events    enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (public.can_see_profile(id));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_self_name on public.profiles;
-- Ο χρήστης αλλάζει μόνο το όνομά του. Ρόλο και email τα προστατεύει το trigger πιο κάτω.
create policy profiles_self_name on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() είναι null όταν τρέχει το SQL Editor του Supabase (ή service role).
  -- Το επιτρέπουμε ώστε να ορίζεται ο πρώτος διαχειριστής (διόρθωση 2026-10-01:
  -- χωρίς αυτό το update του πρώτου admin απέρριπτε το "Μόνο ο διαχειριστής αλλάζει ρόλους").
  -- Οι χρήστες της σελίδας έχουν πάντα auth.uid(), άρα δεν επηρεάζονται.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Μόνο ο διαχειριστής αλλάζει ρόλους';
    end if;
    -- Το email χρησιμοποιείται για προσκλήσεις: αν άλλαζε ελεύθερα, κάποιος θα μπορούσε
    -- να δηλώσει ξένο email και να συνδεθεί σε ξένο μαθητή.
    if new.email is distinct from old.email then
      raise exception 'Το email δεν αλλάζει από εδώ';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_role_trg on public.profiles;
create trigger protect_role_trg before update on public.profiles
  for each row execute function public.protect_role();

-- ---------- Μετάβαση από το παλιό μοντέλο ρόλων / σημειώσεων ----------
-- Ασφαλές σε καινούργια βάση (δεν βρίσκει τίποτα να αλλάξει).

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'teacher' where role in ('main_teacher','assistant_teacher');
update public.profiles set role = 'student' where role in ('pending','parent');
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','teacher','student'));
alter table public.profiles alter column role set default 'student';

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'notes') then
    insert into public.student_notes (student_id, notes)
      select id, notes from public.students where notes is not null
      on conflict do nothing;
    alter table public.students drop column notes;
  end if;
end $$;

-- students
drop policy if exists students_select on public.students;
create policy students_select on public.students for select
  using (public.can_see_student(id));
drop policy if exists students_write on public.students;
create policy students_write on public.students for all
  using (public.is_admin() or (teacher_id = auth.uid() and public.my_role() = 'teacher'))
  with check (public.is_admin() or (teacher_id = auth.uid() and public.my_role() = 'teacher'));

-- student_notes: μόνο ο εκπαιδευτικός του μαθητή και ο διαχειριστής
drop policy if exists notes_all on public.student_notes;
create policy notes_all on public.student_notes for all
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- invites: μόνο ο εκπαιδευτικός του μαθητή και ο διαχειριστής
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

-- lessons: βλέπουν όσοι βλέπουν τον μαθητή, γράφει μόνο ο εκπαιδευτικός του μαθητή
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
