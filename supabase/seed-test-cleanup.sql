-- Σβήνει τα δοκιμαστικά δεδομένα του seed-test.sql. Τους 4 χρήστες σβήσε τους από το Dashboard (Authentication -> Users).
do $$
declare t1 uuid; t2 uuid;
begin
  select id into t1 from public.profiles where email = 'kathigitis1@test.local';
  select id into t2 from public.profiles where email = 'kathigitis2@test.local';
  delete from public.lessons where teacher_id in (t1, t2);
  delete from public.support_sessions where teacher_id in (t1, t2);
  delete from public.students where full_name like '[ΤΕΣΤ]%';
  delete from public.teacher_collabs where from_teacher in (t1, t2) or to_teacher in (t1, t2);
  delete from public.teacher_applications where user_id in (t1, t2);
  update public.profiles set role = 'student' where id in (t1, t2);
end $$;
