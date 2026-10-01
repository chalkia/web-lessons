-- =====================================================
-- ΚΑΘΑΡΙΣΜΟΣ ΠΑΛΙΑΣ ΕΚΔΟΣΗΣ — τρέχει ΜΙΑ φορά, ΠΡΙΝ το schema.sql
-- ΣΒΗΝΕΙ όλα τα δεδομένα της εφαρμογής (μαθητές, μαθήματα, σημειώσεις, προσκλήσεις).
-- ΔΕΝ σβήνει λογαριασμούς (auth.users) ούτε προφίλ. Ο διαχειριστής σου μένει.
-- Χρήση ΜΟΝΟ όσο η πλατφόρμα δεν έχει πραγματικά δεδομένα.
-- Μετά τρέξε ολόκληρο το schema.sql.
-- =====================================================

drop table if exists
  public.support_session_students,
  public.support_sessions,
  public.lesson_students,
  public.lessons,
  public.personal_events,
  public.interest_requests,
  public.teacher_collabs,
  public.teacher_documents,
  public.teacher_applications,
  public.student_notes,
  public.invites,
  public.student_parents,
  public.student_assistants,
  public.students
  cascade;

drop table if exists public.schema_migrations cascade;

-- Μετατροπή των παλιών ρόλων των προφίλ στα τρία νέα είδη λογαριασμού.
-- Απενεργοποιούμε προσωρινά τα triggers του πίνακα ώστε να επιτραπεί η αλλαγή.
alter table public.profiles disable trigger user;
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'teacher' where role in ('main_teacher','assistant_teacher');
update public.profiles set role = 'student' where role in ('pending','parent');
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','teacher','student'));
alter table public.profiles alter column role set default 'student';
alter table public.profiles enable trigger user;

-- Παλιές συναρτήσεις που δεν υπάρχουν πια
drop function if exists public.add_access(uuid, text, text);
