-- =====================================================
-- Πλατφόρμα εξ αποστάσεως ιδιαιτέρων — σχήμα βάσης v3
-- Τρέξε ΟΛΟ αυτό το αρχείο στο Supabase > SQL Editor.
-- Είναι ξαναεκτελέσιμο: δεν σβήνει δεδομένα.
-- Αν έχεις βάση από παλιότερη έκδοση χωρίς πραγματικά δεδομένα, τρέξε πρώτα το reset.sql.
--
-- ΜΟΝΤΕΛΟ
-- Λογαριασμός: admin, teacher ή student ("Μαθητής / γονέας").
-- Ο γονέας και ο βοηθός ΔΕΝ είναι είδη λογαριασμού, είναι σχέσεις ανά μαθητή.
-- Ο εκπαιδευτικός χρειάζεται έγκριση (teacher_applications) με πιστοποιητικά
-- (teacher_documents + ιδιωτικό Storage bucket "credentials").
-- Όλες οι εγγραφές που αλλάζουν δικαιώματα γίνονται από συναρτήσεις (rpc), όχι άμεσα.
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

-- Ιδιωτικές σημειώσεις του εκπαιδευτικού. Χωριστός πίνακας: το RLS δουλεύει ανά γραμμή,
-- όχι ανά στήλη, άρα σε στήλη του students θα τις έβλεπαν και μαθητής, γονείς, βοηθοί.
create table if not exists public.student_notes (
  student_id uuid primary key references public.students(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now()
);

-- Προσκλήσεις μαθητή/γονέα για email που δεν έχει ακόμη λογαριασμό.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  relation text not null check (relation in ('student','parent')),
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

-- Αίτηση εκπαιδευτικού για έγκριση. Δεν υπάρχει γραμμή = δεν έχει ξεκινήσει.
create table if not exists public.teacher_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected')),
  subjects text,
  bio text,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Το δωμάτιο σύγχρονης εκπαίδευσης του εκπαιδευτικού (Meet, Zoom, Jitsi κ.λπ., της επιλογής του).
-- Οι μαθητές μπαίνουν με το κουμπί σύνδεσης, σε νέο παράθυρο. (alter: για βάση που έχει ήδη το v3 χωρίς room_url)
alter table public.teacher_applications add column if not exists room_url text;

-- Τα αρχεία είναι στο ιδιωτικό bucket "credentials", σε φάκελο με το id του χρήστη.
create table if not exists public.teacher_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('degree','masters','phd','certificate','other')),
  file_path text not null,
  file_name text,
  created_at timestamptz not null default now()
);

-- Συνεργασία μεταξύ εκπαιδευτικών. Μόνο συνεργάτες μπορούν να γίνουν βοηθοί.
create table if not exists public.teacher_collabs (
  id uuid primary key default gen_random_uuid(),
  from_teacher uuid not null references public.profiles(id) on delete cascade,
  to_teacher uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (from_teacher, to_teacher),
  check (from_teacher <> to_teacher)
);

-- Αίτημα γονέα προς εκπαιδευτικό. Με την αποδοχή δημιουργείται ο μαθητής και συνδέεται ο γονέας.
create table if not exists public.interest_requests (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  child_name text not null,
  grade text,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- Μάθημα (μπορεί να έχει πολλούς μαθητές). Η κατάσταση/παρουσία είναι ανά μαθητή.
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists lessons_teacher_idx on public.lessons(teacher_id, starts_at);

create table if not exists public.lesson_students (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'planned'
    check (status in ('planned','done','cancelled','absent')),
  primary key (lesson_id, student_id)
);
create index if not exists lesson_students_student_idx on public.lesson_students(student_id);

-- Ώρα υποστήριξης: ο εκπαιδευτικός αναθέτει στον βοηθό δική του ώρα με συγκεκριμένους μαθητές.
create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  assistant_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists support_teacher_idx on public.support_sessions(teacher_id, starts_at);
create index if not exists support_assistant_idx on public.support_sessions(assistant_id, starts_at);

create table if not exists public.support_session_students (
  session_id uuid not null references public.support_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (session_id, student_id)
);

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

-- Εγκεκριμένος εκπαιδευτικός (η έγκριση δίνεται μόνο από τον διαχειριστή).
create or replace function public.is_approved_teacher(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_applications a
    join public.profiles p on p.id = a.user_id
    where a.user_id = uid and a.status = 'approved' and p.role = 'teacher')
$$;

-- Μπορεί ο τρέχων χρήστης να λειτουργήσει ως εκπαιδευτικός;
create or replace function public.my_teacher_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_approved_teacher(auth.uid())
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

-- Βλέπει ο τρέχων χρήστης αυτό το μάθημα;
create or replace function public.can_see_lesson(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.lessons l where l.id = lid and l.teacher_id = auth.uid())
    or exists (select 1 from public.lesson_students ls
               where ls.lesson_id = lid and public.can_see_student(ls.student_id))
$$;

-- Βλέπει ο τρέχων χρήστης αυτή την ώρα υποστήριξης;
create or replace function public.can_see_support(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.support_sessions s
               where s.id = sid and (s.teacher_id = auth.uid() or s.assistant_id = auth.uid()))
    or exists (select 1 from public.support_session_students x
               where x.session_id = sid and public.can_see_student(x.student_id))
$$;

-- Βλέπει ο τρέχων χρήστης αυτό το προφίλ (με email); Ελάχιστη έκθεση.
create or replace function public.can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pid = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.students s
      where s.teacher_id = auth.uid()
        and (s.user_id = pid
          or exists (select 1 from public.student_parents p where p.student_id = s.id and p.parent_id = pid)
          or exists (select 1 from public.student_assistants a where a.student_id = s.id and a.assistant_id = pid)))
    or exists (select 1 from public.interest_requests r where r.teacher_id = auth.uid() and r.parent_id = pid)
$$;

-- Μόνο ΟΝΟΜΑΤΑ (όχι email) για εκπαιδευτικούς και βοηθούς που σχετίζονται με μαθητές που βλέπω.
create or replace function public.names_for(ids uuid[])
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
  where auth.uid() is not null and p.id = any(ids) and (
    p.id = auth.uid() or public.is_admin() or public.can_see_profile(p.id)
    or exists (select 1 from public.students s where s.teacher_id = p.id and public.can_see_student(s.id))
    or exists (select 1 from public.student_assistants sa
               where sa.assistant_id = p.id and public.can_see_student(sa.student_id)))
$$;

-- Δωμάτια (σύνδεσμοι) των εκπαιδευτικών/βοηθών που σχετίζονται με μαθητές που βλέπω. Ίδια ορατότητα με το names_for.
create or replace function public.rooms_for(ids uuid[])
returns table (id uuid, room_url text)
language sql stable security definer set search_path = public as $$
  select p.id, a.room_url from public.profiles p
  join public.teacher_applications a
    on a.user_id = p.id and a.status = 'approved' and a.room_url is not null
  where auth.uid() is not null and p.id = any(ids) and (
    p.id = auth.uid() or public.is_admin() or public.can_see_profile(p.id)
    or exists (select 1 from public.students s where s.teacher_id = p.id and public.can_see_student(s.id))
    or exists (select 1 from public.student_assistants sa
               where sa.assistant_id = p.id and public.can_see_student(sa.student_id)))
$$;

-- Κατάλογος εγκεκριμένων εκπαιδευτικών (χωρίς email), με την κατάσταση συνεργασίας με τον τρέχοντα.
create or replace function public.teacher_directory()
returns table (id uuid, full_name text, subjects text, bio text,
               collab_id uuid, collab_status text, collab_direction text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, a.subjects, a.bio, c.id, c.status,
         case when c.from_teacher = auth.uid() then 'out'
              when c.to_teacher = auth.uid() then 'in' else null end
  from public.teacher_applications a
  join public.profiles p on p.id = a.user_id
  left join public.teacher_collabs c
    on (c.from_teacher = auth.uid() and c.to_teacher = p.id)
    or (c.to_teacher = auth.uid() and c.from_teacher = p.id)
  where auth.uid() is not null and a.status = 'approved' and p.role = 'teacher' and p.id <> auth.uid()
  order by p.full_name
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

  insert into public.student_parents (student_id, parent_id)
    select student_id, new.id from public.invites
    where lower(email) = lower(new.email) and relation = 'parent'
    on conflict do nothing;
  delete from public.invites
    where lower(email) = lower(new.email) and relation = 'parent';

  update public.students s set user_id = new.id
    from public.invites i
    where i.student_id = s.id and i.relation = 'student'
      and lower(i.email) = lower(new.email) and s.user_id is null;
  delete from public.invites i
    where lower(i.email) = lower(new.email) and i.relation = 'student'
      and exists (select 1 from public.students s where s.id = i.student_id and s.user_id = new.id);

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

-- Ο βοηθός αλλάζει μόνο κατάσταση και σημειώσεις στις ώρες υποστήριξης που του αναθέτουν.
create or replace function public.guard_support_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and auth.uid() <> old.teacher_id then
    if new.teacher_id is distinct from old.teacher_id
       or new.assistant_id is distinct from old.assistant_id
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at then
      raise exception 'Ο βοηθός αλλάζει μόνο κατάσταση και σημειώσεις';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_support_trg on public.support_sessions;
create trigger guard_support_trg before update on public.support_sessions
  for each row execute function public.guard_support_update();

-- ---------- Συναρτήσεις ενεργειών (rpc) ----------
-- Όλες ελέγχουν auth.uid(). Δεν επιτρέπονται στον ανώνυμο χρήστη (βλ. revoke/grant στο τέλος).

-- Πρόσκληση μαθητή ή γονέα με email. Αν υπάρχει ήδη λογαριασμός, συνδέεται αμέσως,
-- αλλιώς μένει πρόσκληση. Επιστρέφει πάντα 'ok': δεν αποκαλύπτουμε αν ένα email έχει λογαριασμό.
create or replace function public.add_access(sid uuid, target_email text, rel text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  em text := lower(trim(target_email));
  uid uuid;
begin
  if rel not in ('student','parent') then
    raise exception 'Άκυρη σχέση';
  end if;
  if em is null or em = '' or length(em) > 254 then
    raise exception 'Άκυρο email';
  end if;

  select teacher_id into owner_id from public.students where id = sid;
  if owner_id is null then
    raise exception 'Δεν βρέθηκε ο μαθητής';
  end if;
  if not (public.is_admin() or (owner_id = auth.uid() and public.my_teacher_ok())) then
    raise exception 'Δεν έχεις δικαίωμα σε αυτόν τον μαθητή';
  end if;

  -- Το email το παίρνουμε από το auth.users (αυθεντικό), όχι από το profiles.
  select u.id into uid from auth.users u where lower(u.email) = em limit 1;

  if uid is not null then
    if rel = 'parent' then
      insert into public.student_parents (student_id, parent_id) values (sid, uid)
        on conflict do nothing;
      return 'ok';
    elsif rel = 'student'
      and exists (select 1 from public.students where id = sid and user_id is null) then
      update public.students set user_id = uid where id = sid;
      return 'ok';
    end if;
  end if;

  insert into public.invites (email, student_id, relation) values (em, sid, rel)
    on conflict do nothing;
  return 'ok';
end $$;

-- Ανάθεση συνεργάτη ως βοηθού σε μαθητή. Απαιτεί αποδεκτή συνεργασία και εγκεκριμένο βοηθό.
create or replace function public.add_assistant(sid uuid, p_assistant uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
begin
  select teacher_id into owner_id from public.students where id = sid;
  if owner_id is null then
    raise exception 'Δεν βρέθηκε ο μαθητής';
  end if;
  if not (public.is_admin() or (owner_id = auth.uid() and public.my_teacher_ok())) then
    raise exception 'Δεν έχεις δικαίωμα σε αυτόν τον μαθητή';
  end if;
  if p_assistant = owner_id or not public.is_approved_teacher(p_assistant) then
    raise exception 'Ο βοηθός πρέπει να είναι άλλος εγκεκριμένος εκπαιδευτικός';
  end if;
  if not exists (
    select 1 from public.teacher_collabs c
    where c.status = 'accepted'
      and ((c.from_teacher = owner_id and c.to_teacher = p_assistant)
        or (c.to_teacher = owner_id and c.from_teacher = p_assistant))) then
    raise exception 'Πρέπει πρώτα να υπάρχει αποδεκτή συνεργασία με αυτόν τον εκπαιδευτικό';
  end if;
  insert into public.student_assistants (student_id, assistant_id) values (sid, p_assistant)
    on conflict do nothing;
  return 'ok';
end $$;

-- Αίτηση εκπαιδευτικού: αποθήκευση στοιχείων
create or replace function public.save_application(p_subjects text, p_bio text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception 'Μόνο λογαριασμός εκπαιδευτικού';
  end if;
  if length(coalesce(p_subjects,'')) > 200 or length(coalesce(p_bio,'')) > 1000 then
    raise exception 'Πολύ μεγάλο κείμενο';
  end if;
  insert into public.teacher_applications (user_id, subjects, bio)
    values (auth.uid(), nullif(trim(p_subjects),''), nullif(trim(p_bio),''))
    on conflict (user_id) do update
      set subjects = excluded.subjects, bio = excluded.bio;
  return 'ok';
end $$;

-- Ο εγκεκριμένος εκπαιδευτικός ορίζει το δωμάτιό του. Μόνο https. Κενό = αφαίρεση.
create or replace function public.save_room(p_url text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved_teacher(auth.uid()) then
    raise exception 'Χρειάζεται εγκεκριμένος εκπαιδευτικός';
  end if;
  if coalesce(trim(p_url),'') <> '' and (trim(p_url) !~* '^https://' or length(p_url) > 500) then
    raise exception 'Ο σύνδεσμος πρέπει να αρχίζει με https://';
  end if;
  update public.teacher_applications set room_url = nullif(trim(p_url),'') where user_id = auth.uid();
  return 'ok';
end $$;

-- Αίτηση εκπαιδευτικού: υποβολή για έλεγχο
create or replace function public.submit_application()
returns text
language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception 'Μόνο λογαριασμός εκπαιδευτικού';
  end if;
  select * into a from public.teacher_applications where user_id = auth.uid();
  if not found or coalesce(a.subjects,'') = '' then
    raise exception 'Συμπλήρωσε πρώτα τα αντικείμενα διδασκαλίας και αποθήκευσε';
  end if;
  if a.status not in ('draft','rejected') then
    raise exception 'Η αίτηση έχει ήδη υποβληθεί';
  end if;
  if not exists (select 1 from public.teacher_documents where user_id = auth.uid()) then
    raise exception 'Ανέβασε τουλάχιστον ένα πιστοποιητικό';
  end if;
  update public.teacher_applications
    set status = 'pending', submitted_at = now(), review_note = null
    where user_id = auth.uid();
  return 'ok';
end $$;

-- Έγκριση / απόρριψη (μόνο διαχειριστής)
create or replace function public.review_application(p_user uuid, p_approve boolean, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Μόνο ο διαχειριστής';
  end if;
  if not p_approve and coalesce(trim(p_note),'') = '' then
    raise exception 'Γράψε τον λόγο της απόρριψης';
  end if;
  update public.teacher_applications
    set status = case when p_approve then 'approved' else 'rejected' end,
        review_note = nullif(trim(p_note),''),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where user_id = p_user and status in ('pending','approved');
  if not found then
    raise exception 'Δεν βρέθηκε αίτηση προς έλεγχο';
  end if;
  return 'ok';
end $$;

-- Πρόσκληση συνεργασίας σε άλλον εγκεκριμένο εκπαιδευτικό
create or replace function public.request_collab(p_target uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved_teacher(auth.uid()) then
    raise exception 'Χρειάζεται εγκεκριμένος εκπαιδευτικός';
  end if;
  if p_target = auth.uid() or not public.is_approved_teacher(p_target) then
    raise exception 'Άκυρος εκπαιδευτικός';
  end if;
  if exists (select 1 from public.teacher_collabs c
             where (c.from_teacher = auth.uid() and c.to_teacher = p_target)
                or (c.from_teacher = p_target and c.to_teacher = auth.uid())) then
    return 'ok';
  end if;
  insert into public.teacher_collabs (from_teacher, to_teacher) values (auth.uid(), p_target);
  return 'ok';
end $$;

create or replace function public.respond_collab(p_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
begin
  update public.teacher_collabs
    set status = case when p_accept then 'accepted' else 'declined' end
    where id = p_id and to_teacher = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Δεν βρέθηκε πρόσκληση προς εσένα';
  end if;
  return 'ok';
end $$;

-- Λήξη συνεργασίας από οποιονδήποτε από τους δύο. Αφαιρεί και τις αναθέσεις βοηθού μεταξύ τους.
create or replace function public.remove_collab(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select * into c from public.teacher_collabs
    where id = p_id and (from_teacher = auth.uid() or to_teacher = auth.uid());
  if not found then
    raise exception 'Δεν βρέθηκε η συνεργασία';
  end if;
  delete from public.student_assistants sa
    using public.students s
    where sa.student_id = s.id
      and ((s.teacher_id = c.from_teacher and sa.assistant_id = c.to_teacher)
        or (s.teacher_id = c.to_teacher and sa.assistant_id = c.from_teacher));
  delete from public.teacher_collabs where id = p_id;
  return 'ok';
end $$;

-- Αίτημα γονέα προς εγκεκριμένο εκπαιδευτικό
create or replace function public.send_interest(p_teacher uuid, p_child text, p_grade text, p_msg text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'Το αίτημα στέλνεται από λογαριασμό μαθητή ή γονέα';
  end if;
  if not public.is_approved_teacher(p_teacher) then
    raise exception 'Ο εκπαιδευτικός δεν είναι διαθέσιμος';
  end if;
  if coalesce(trim(p_child),'') = '' or length(p_child) > 100
     or length(coalesce(p_grade,'')) > 50 or length(coalesce(p_msg,'')) > 1000 then
    raise exception 'Έλεγξε τα στοιχεία του αιτήματος';
  end if;
  if exists (select 1 from public.interest_requests
             where parent_id = auth.uid() and teacher_id = p_teacher and status = 'pending') then
    raise exception 'Έχεις ήδη εκκρεμές αίτημα προς αυτόν τον εκπαιδευτικό';
  end if;
  if (select count(*) from public.interest_requests
      where parent_id = auth.uid() and status = 'pending') >= 10 then
    raise exception 'Έχεις πολλά εκκρεμή αιτήματα';
  end if;
  insert into public.interest_requests (parent_id, teacher_id, child_name, grade, message)
    values (auth.uid(), p_teacher, trim(p_child), nullif(trim(p_grade),''), nullif(trim(p_msg),''))
    returning id into rid;
  return rid;
end $$;

-- Απάντηση εκπαιδευτικού. Με αποδοχή: δημιουργείται ο μαθητής και συνδέεται ο γονέας.
create or replace function public.respond_interest(p_id uuid, p_accept boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
  sid uuid;
begin
  select * into r from public.interest_requests
    where id = p_id and teacher_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Δεν βρέθηκε αίτημα προς εσένα';
  end if;
  if not public.is_approved_teacher(auth.uid()) then
    raise exception 'Χρειάζεται εγκεκριμένος εκπαιδευτικός';
  end if;
  if p_accept then
    insert into public.students (teacher_id, full_name, grade)
      values (r.teacher_id, r.child_name, r.grade) returning id into sid;
    insert into public.student_parents (student_id, parent_id) values (sid, r.parent_id);
    update public.interest_requests
      set status = 'accepted', student_id = sid, responded_at = now() where id = p_id;
    return sid;
  end if;
  update public.interest_requests set status = 'declined', responded_at = now() where id = p_id;
  return null;
end $$;

-- Δημιουργία μαθήματος με έναν ή περισσότερους μαθητές (ομαδικό μάθημα), ατομικά.
create or replace function public.create_lesson(
  p_students uuid[], p_start timestamptz, p_end timestamptz, p_url text, p_notes text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owners uuid[];
  n_found int;
  n_unique int;
  t uuid;
  lid uuid;
begin
  if not public.my_teacher_ok() then
    raise exception 'Χρειάζεται εγκεκριμένος εκπαιδευτικός';
  end if;
  if p_students is null or array_length(p_students, 1) is null or array_length(p_students, 1) > 30 then
    raise exception 'Διάλεξε 1 έως 30 μαθητές';
  end if;
  if p_end <= p_start or p_end - p_start > interval '12 hours' then
    raise exception 'Άκυρη διάρκεια';
  end if;
  if coalesce(p_url,'') <> '' and (p_url !~* '^https?://' or length(p_url) > 500) then
    raise exception 'Ο σύνδεσμος πρέπει να αρχίζει με http:// ή https://';
  end if;
  if length(coalesce(p_notes,'')) > 500 then
    raise exception 'Πολύ μεγάλες σημειώσεις';
  end if;
  select count(distinct x) into n_unique from unnest(p_students) x;
  select array_agg(distinct teacher_id), count(*) into owners, n_found
    from public.students where id = any(p_students);
  if n_found <> n_unique or array_length(owners, 1) <> 1 then
    raise exception 'Άκυροι μαθητές (πρέπει να ανήκουν στον ίδιο εκπαιδευτικό)';
  end if;
  t := owners[1];
  if t <> auth.uid() and not public.is_admin() then
    raise exception 'Οι μαθητές δεν είναι δικοί σου';
  end if;
  insert into public.lessons (teacher_id, starts_at, ends_at, meeting_url, notes)
    values (t, p_start, p_end, nullif(p_url,''), nullif(p_notes,'')) returning id into lid;
  insert into public.lesson_students (lesson_id, student_id)
    select lid, q.x from (select distinct unnest(p_students) as x) q;
  return lid;
end $$;

-- Ανάθεση ώρας υποστήριξης σε βοηθό για συγκεκριμένους μαθητές.
create or replace function public.create_support_session(
  p_assistant uuid, p_students uuid[], p_start timestamptz, p_end timestamptz, p_notes text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owners uuid[];
  n_found int;
  n_unique int;
  n_assisted int;
  t uuid;
  sid uuid;
begin
  if not public.my_teacher_ok() then
    raise exception 'Χρειάζεται εγκεκριμένος εκπαιδευτικός';
  end if;
  if p_students is null or array_length(p_students, 1) is null or array_length(p_students, 1) > 30 then
    raise exception 'Διάλεξε 1 έως 30 μαθητές';
  end if;
  if p_end <= p_start or p_end - p_start > interval '12 hours' then
    raise exception 'Άκυρη διάρκεια';
  end if;
  if length(coalesce(p_notes,'')) > 500 then
    raise exception 'Πολύ μεγάλες σημειώσεις';
  end if;
  select count(distinct x) into n_unique from unnest(p_students) x;
  select array_agg(distinct teacher_id), count(*) into owners, n_found
    from public.students where id = any(p_students);
  if n_found <> n_unique or array_length(owners, 1) <> 1 then
    raise exception 'Άκυροι μαθητές (πρέπει να ανήκουν στον ίδιο εκπαιδευτικό)';
  end if;
  t := owners[1];
  if t <> auth.uid() and not public.is_admin() then
    raise exception 'Οι μαθητές δεν είναι δικοί σου';
  end if;
  select count(*) into n_assisted from public.student_assistants
    where assistant_id = p_assistant and student_id = any(p_students);
  if n_assisted <> n_unique then
    raise exception 'Ο βοηθός πρέπει να είναι ανατεθειμένος σε όλους τους επιλεγμένους μαθητές';
  end if;
  insert into public.support_sessions (teacher_id, assistant_id, starts_at, ends_at, notes)
    values (t, p_assistant, p_start, p_end, nullif(p_notes,'')) returning id into sid;
  insert into public.support_session_students (session_id, student_id)
    select sid, q.x from (select distinct unnest(p_students) as x) q;
  return sid;
end $$;

-- Δικαιώματα εκτέλεσης: μόνο συνδεδεμένοι χρήστες (όχι ανώνυμοι).
revoke execute on function public.add_access(uuid, text, text) from public;
revoke execute on function public.add_assistant(uuid, uuid) from public;
revoke execute on function public.save_application(text, text) from public;
revoke execute on function public.submit_application() from public;
revoke execute on function public.review_application(uuid, boolean, text) from public;
revoke execute on function public.request_collab(uuid) from public;
revoke execute on function public.respond_collab(uuid, boolean) from public;
revoke execute on function public.remove_collab(uuid) from public;
revoke execute on function public.send_interest(uuid, text, text, text) from public;
revoke execute on function public.respond_interest(uuid, boolean) from public;
revoke execute on function public.create_lesson(uuid[], timestamptz, timestamptz, text, text) from public;
revoke execute on function public.create_support_session(uuid, uuid[], timestamptz, timestamptz, text) from public;
revoke execute on function public.save_room(text) from public;
revoke execute on function public.rooms_for(uuid[]) from public;
grant execute on function public.save_room(text) to authenticated;
grant execute on function public.rooms_for(uuid[]) to authenticated;
revoke execute on function public.names_for(uuid[]) from public;
revoke execute on function public.teacher_directory() from public;
grant execute on function public.add_access(uuid, text, text) to authenticated;
grant execute on function public.add_assistant(uuid, uuid) to authenticated;
grant execute on function public.save_application(text, text) to authenticated;
grant execute on function public.submit_application() to authenticated;
grant execute on function public.review_application(uuid, boolean, text) to authenticated;
grant execute on function public.request_collab(uuid) to authenticated;
grant execute on function public.respond_collab(uuid, boolean) to authenticated;
grant execute on function public.remove_collab(uuid) to authenticated;
grant execute on function public.send_interest(uuid, text, text, text) to authenticated;
grant execute on function public.respond_interest(uuid, boolean) to authenticated;
grant execute on function public.create_lesson(uuid[], timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.create_support_session(uuid, uuid[], timestamptz, timestamptz, text) to authenticated;
grant execute on function public.names_for(uuid[]) to authenticated;
grant execute on function public.teacher_directory() to authenticated;

-- ---------- Κανόνες πρόσβασης (RLS) ----------

alter table public.profiles                enable row level security;
alter table public.students                enable row level security;
alter table public.student_notes           enable row level security;
alter table public.invites                 enable row level security;
alter table public.student_parents         enable row level security;
alter table public.student_assistants      enable row level security;
alter table public.teacher_applications    enable row level security;
alter table public.teacher_documents       enable row level security;
alter table public.teacher_collabs         enable row level security;
alter table public.interest_requests       enable row level security;
alter table public.lessons                 enable row level security;
alter table public.lesson_students         enable row level security;
alter table public.support_sessions        enable row level security;
alter table public.support_session_students enable row level security;
alter table public.personal_events         enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (public.can_see_profile(id));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_self_name on public.profiles;
-- Ο χρήστης αλλάζει μόνο το όνομά του. Ρόλο και email τα προστατεύει το trigger.
create policy profiles_self_name on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- students: γράφει μόνο εγκεκριμένος εκπαιδευτικός (ή διαχειριστής) για τους δικούς του μαθητές
drop policy if exists students_select on public.students;
create policy students_select on public.students for select
  using (public.can_see_student(id));
drop policy if exists students_write on public.students;
create policy students_write on public.students for all
  using (public.is_admin() or (teacher_id = auth.uid() and public.my_teacher_ok()))
  with check (public.is_admin() or (teacher_id = auth.uid() and public.my_teacher_ok()));

-- student_notes: μόνο ο εκπαιδευτικός του μαθητή και ο διαχειριστής
drop policy if exists notes_all on public.student_notes;
create policy notes_all on public.student_notes for all
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- invites: ο εκπαιδευτικός του μαθητή βλέπει και σβήνει. Η δημιουργία γίνεται από add_access.
drop policy if exists invites_all on public.invites;
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- γονείς / βοηθοί: οι συνδέσεις μπαίνουν μόνο από rpc. Ο εκπαιδευτικός μπορεί να τις αφαιρέσει.
drop policy if exists sp_select on public.student_parents;
create policy sp_select on public.student_parents for select
  using (public.can_see_student(student_id));
drop policy if exists sp_write on public.student_parents;
drop policy if exists sp_delete on public.student_parents;
create policy sp_delete on public.student_parents for delete
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists sa_select on public.student_assistants;
create policy sa_select on public.student_assistants for select
  using (public.can_see_student(student_id));
drop policy if exists sa_write on public.student_assistants;
drop policy if exists sa_delete on public.student_assistants;
create policy sa_delete on public.student_assistants for delete
  using (public.is_admin() or exists (
    select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

-- teacher_applications: διαβάζει ο ίδιος και ο διαχειριστής. Γράφεται μόνο από rpc.
drop policy if exists ta_select on public.teacher_applications;
create policy ta_select on public.teacher_applications for select
  using (user_id = auth.uid() or public.is_admin());

-- teacher_documents: τα βλέπει ο ίδιος και ο διαχειριστής. Αλλαγές μόνο όσο η αίτηση δεν είναι υπό έλεγχο ή εγκεκριμένη.
drop policy if exists td_select on public.teacher_documents;
create policy td_select on public.teacher_documents for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists td_insert on public.teacher_documents;
create policy td_insert on public.teacher_documents for insert
  with check (
    user_id = auth.uid() and public.my_role() = 'teacher'
    and not exists (select 1 from public.teacher_applications a
                    where a.user_id = auth.uid() and a.status in ('pending','approved')));
drop policy if exists td_delete on public.teacher_documents;
create policy td_delete on public.teacher_documents for delete
  using (
    user_id = auth.uid()
    and not exists (select 1 from public.teacher_applications a
                    where a.user_id = auth.uid() and a.status in ('pending','approved')));

-- teacher_collabs και interest_requests: ανάγνωση μόνο από τα εμπλεκόμενα μέρη. Γράφονται από rpc.
drop policy if exists tc_select on public.teacher_collabs;
create policy tc_select on public.teacher_collabs for select
  using (from_teacher = auth.uid() or to_teacher = auth.uid() or public.is_admin());

drop policy if exists ir_select on public.interest_requests;
create policy ir_select on public.interest_requests for select
  using (parent_id = auth.uid() or teacher_id = auth.uid() or public.is_admin());

-- lessons
drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select
  using (public.can_see_lesson(id));
drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons for all
  using (public.is_admin() or (teacher_id = auth.uid() and public.my_teacher_ok()))
  with check (public.is_admin() or (teacher_id = auth.uid() and public.my_teacher_ok()));

-- lesson_students: ο μαθητής/γονέας βλέπει ΜΟΝΟ τη δική του γραμμή
drop policy if exists ls_select on public.lesson_students;
create policy ls_select on public.lesson_students for select
  using (public.can_see_student(student_id));
drop policy if exists ls_write on public.lesson_students;
create policy ls_write on public.lesson_students for all
  using (public.is_admin() or (public.my_teacher_ok() and exists (
    select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid())))
  with check (public.is_admin() or (public.my_teacher_ok()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid())
    and exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid())));

-- support_sessions: δημιουργία μόνο από rpc. Αλλαγή κατάστασης από εκπαιδευτικό ή βοηθό.
drop policy if exists ss_select on public.support_sessions;
create policy ss_select on public.support_sessions for select
  using (public.can_see_support(id));
drop policy if exists ss_update on public.support_sessions;
create policy ss_update on public.support_sessions for update
  using (public.is_admin() or teacher_id = auth.uid() or assistant_id = auth.uid())
  with check (public.is_admin() or teacher_id = auth.uid() or assistant_id = auth.uid());
drop policy if exists ss_delete on public.support_sessions;
create policy ss_delete on public.support_sessions for delete
  using (public.is_admin() or teacher_id = auth.uid());

drop policy if exists sss_select on public.support_session_students;
create policy sss_select on public.support_session_students for select
  using (public.can_see_student(student_id));

-- personal_events: μόνο ο ιδιοκτήτης
drop policy if exists pe_all on public.personal_events;
create policy pe_all on public.personal_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Αποθήκευση πιστοποιητικών (Storage) ----------
-- Ιδιωτικό bucket. Ο καθένας γράφει/διαβάζει μόνο στον φάκελο με το δικό του id.
-- Ο διαχειριστής διαβάζει όλα (για τον έλεγχο). Μέγιστο 5 MB, μόνο PDF/JPG/PNG.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('credentials', 'credentials', false, 5242880,
          array['application/pdf','image/jpeg','image/png'])
  on conflict (id) do update
    set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists cred_owner_all on storage.objects;
create policy cred_owner_all on storage.objects for all to authenticated
  using (bucket_id = 'credentials' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'credentials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists cred_admin_read on storage.objects;
create policy cred_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'credentials' and public.is_admin());

-- =====================================================
-- ΠΡΩΤΟΣ ΔΙΑΧΕΙΡΙΣΤΗΣ
-- 1) Εγγράψου στην εφαρμογή με το email σου.
-- 2) Τρέξε (με το δικό σου email):
--    update public.profiles set role = 'admin' where email = 'το-email-σου@example.com';
-- =====================================================
