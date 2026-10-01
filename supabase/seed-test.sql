-- ΔΟΚΙΜΑΣΤΙΚΑ ΔΕΔΟΜΕΝΑ. Τρέξε το ΜΟΝΟ στο SQL Editor, αφού τρέξει το schema.sql.
-- Βήμα 1 (στο Dashboard): Authentication -> Users -> Add user -> Create new user.
--   Βάλε κωδικό και τσέκαρε "Auto Confirm User". Φτιάξε αυτά τα 4 email:
--     kathigitis1@test.local   (κύριος εκπαιδευτικός)
--     kathigitis2@test.local   (συνεργάτης / βοηθός)
--     goneas@test.local        (γονέας)
--     mathitis@test.local      (μαθητής)
-- Βήμα 2: τρέξε αυτό το script. Στήνει ρόλους, έγκριση, συνεργασία, μαθητή, μάθημα και ώρα υποστήριξης.
-- Μπορείς να το ξανατρέξεις: καθαρίζει πρώτα τα δοκιμαστικά του.
-- Καθάρισμα στο τέλος: τρέξε supabase/seed-test-cleanup.sql

do $$
declare
  t1 uuid; t2 uuid; par uuid; stu uuid;
  sid uuid; lid uuid; ssid uuid;
begin
  select id into t1  from public.profiles where email = 'kathigitis1@test.local';
  select id into t2  from public.profiles where email = 'kathigitis2@test.local';
  select id into par from public.profiles where email = 'goneas@test.local';
  select id into stu from public.profiles where email = 'mathitis@test.local';
  if t1 is null or t2 is null or par is null or stu is null then
    raise exception 'Λείπει κάποιος από τους 4 δοκιμαστικούς χρήστες. Φτιάξε τους πρώτα από το Dashboard.';
  end if;

  -- Καθάρισμα προηγούμενης δοκιμής
  delete from public.lessons where teacher_id in (t1, t2);
  delete from public.support_sessions where teacher_id in (t1, t2);
  delete from public.students where teacher_id = t1 and full_name like '[ΤΕΣΤ]%';
  delete from public.teacher_collabs where from_teacher in (t1, t2) and to_teacher in (t1, t2);

  -- Ρόλοι και ονόματα
  update public.profiles set role = 'teacher', full_name = 'Δοκιμαστικός Εκπαιδευτικός 1' where id = t1;
  update public.profiles set role = 'teacher', full_name = 'Δοκιμαστικός Εκπαιδευτικός 2' where id = t2;
  update public.profiles set role = 'student', full_name = 'Δοκιμαστικός Γονέας' where id = par;
  update public.profiles set role = 'student', full_name = 'Δοκιμαστικός Μαθητής' where id = stu;

  -- Εγκεκριμένοι εκπαιδευτικοί (ο διαχειριστής είναι ο δικός σου λογαριασμός, δεν χρειάζεται εδώ)
  insert into public.teacher_applications (user_id, status, subjects, bio, submitted_at, reviewed_at)
  values (t1, 'approved', 'Φυσική, Χημεία', 'Δοκιμαστικό προφίλ 1', now(), now()),
         (t2, 'approved', 'Μαθηματικά', 'Δοκιμαστικό προφίλ 2', now(), now())
  on conflict (user_id) do update set status = 'approved', reviewed_at = now();

  update public.teacher_applications set room_url = 'https://meet.jit.si/dokimastiko-domatio-1' where user_id = t1;

  -- Συνεργασία 1 -> 2
  insert into public.teacher_collabs (from_teacher, to_teacher, status) values (t1, t2, 'accepted');

  -- Μαθητής του εκπαιδευτικού 1, με λογαριασμό, γονέα και βοηθό
  insert into public.students (teacher_id, full_name, grade, user_id)
  values (t1, '[ΤΕΣΤ] Μαρία', 'Β Λυκείου', stu) returning id into sid;
  insert into public.student_parents (student_id, parent_id) values (sid, par);
  insert into public.student_assistants (student_id, assistant_id) values (sid, t2);

  -- Μάθημα αύριο (προγραμματισμένο) και ένα χθες (πραγματοποιήθηκε)
  insert into public.lessons (teacher_id, starts_at, ends_at)
  values (t1, date_trunc('hour', now()) + interval '1 day', date_trunc('hour', now()) + interval '1 day 1 hour')
  returning id into lid;
  insert into public.lesson_students (lesson_id, student_id, status) values (lid, sid, 'planned');

  insert into public.lessons (teacher_id, starts_at, ends_at)
  values (t1, date_trunc('hour', now()) - interval '1 day', date_trunc('hour', now()) - interval '23 hours')
  returning id into lid;
  insert into public.lesson_students (lesson_id, student_id, status) values (lid, sid, 'done');

  -- Ώρα υποστήριξης του βοηθού
  insert into public.support_sessions (teacher_id, assistant_id, starts_at, ends_at, status, notes)
  values (t1, t2, date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour', 'planned', 'Διόρθωση εργασίας')
  returning id into ssid;
  insert into public.support_session_students (session_id, student_id) values (ssid, sid);

  raise notice 'Έτοιμο. Μπες ως kathigitis1, kathigitis2, goneas και mathitis για να δεις τι βλέπει ο καθένας.';
end $$;
