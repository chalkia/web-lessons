create schema if not exists t; grant usage on schema t to authenticated, anon;
create or replace function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create or replace function t.as_super() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create or replace function t.ok(label text, cond boolean) returns void language plpgsql as $$ begin if coalesce(cond,false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if; end $$;
create or replace function t.fails(label text, q text) returns void language plpgsql as $$ begin execute q; raise notice 'FAIL  % (δεν απέτυχε)', label; exception when others then raise notice 'PASS  % [%]', label, left(sqlerrm,60); end $$;
create or replace function t.n(q text) returns bigint language plpgsql as $$ declare r bigint; begin execute q into r; return r; end $$;
grant execute on all functions in schema t to authenticated, anon;

do $$
declare
  adm uuid:='00000000-0000-0000-0000-0000000000a1'; t1 uuid:='00000000-0000-0000-0000-0000000000b1';
  t2 uuid:='00000000-0000-0000-0000-0000000000b2'; t3 uuid:='00000000-0000-0000-0000-0000000000b3';
  un uuid:='00000000-0000-0000-0000-0000000000b4'; p1 uuid:='00000000-0000-0000-0000-0000000000c1';
  p2 uuid:='00000000-0000-0000-0000-0000000000c2'; p3 uuid:='00000000-0000-0000-0000-0000000000c3';
  s1 uuid; s2 uuid; s3 uuid; mid uuid; lid uuid; sess uuid; rid uuid; cid uuid; n bigint;
begin
  perform t.as_super();
  insert into auth.users(id,email,raw_user_meta_data) values
   (adm,'admin@x.gr','{"full_name":"Admin","account_type":"student"}'),
   (t1,'t1@x.gr','{"full_name":"Teacher One","account_type":"teacher"}'),
   (t2,'t2@x.gr','{"full_name":"Teacher Two","account_type":"teacher"}'),
   (t3,'t3@x.gr','{"full_name":"Teacher Three","account_type":"teacher"}'),
   (un,'un@x.gr','{"full_name":"Unapproved","account_type":"teacher"}'),
   (p1,'p1@x.gr','{"full_name":"Parent One"}'),(p2,'p2@x.gr','{"full_name":"Parent Two","account_type":"family"}'),
   (p3,'p3@x.gr','{"full_name":"Parent Three","account_type":"admin"}');
  update profiles set role='admin' where id=adm;
  perform t.ok('εγγραφή ως admin από τη σελίδα αγνοείται', (select role from profiles where id=p3)='student');

  -- Έγκριση εκπαιδευτικού
  perform t.as_user(un);
  perform t.fails('μη εγκεκριμένος δεν προσθέτει μαθητή', $q$insert into students(teacher_id,full_name) values ('00000000-0000-0000-0000-0000000000b4','X')$q$);
  perform t.fails('υποβολή χωρίς στοιχεία/έγγραφο', $q$select submit_application()$q$);
  perform save_application('Φυσική','Βιογραφικό');
  perform t.fails('υποβολή χωρίς πιστοποιητικό', $q$select submit_application()$q$);
  insert into teacher_documents(user_id,kind,file_path,file_name) values (un,'degree',un||'/a.pdf','a.pdf');
  perform t.fails('δεν ανεβάζει έγγραφο για άλλον', $q$insert into teacher_documents(user_id,kind,file_path) values ('00000000-0000-0000-0000-0000000000b1','degree','x')$q$);
  perform submit_application();
  perform t.ok('κατάσταση pending μετά την υποβολή', (select status from teacher_applications where user_id=un)='pending');
  delete from teacher_documents where user_id=un;
  perform t.as_super(); perform t.ok('δεν σβήνει έγγραφο υπό έλεγχο', (select count(*) from teacher_documents where user_id=un)=1); perform t.as_user(un);
  perform t.fails('ο εκπαιδευτικός δεν εγκρίνει τον εαυτό του', format($q$select review_application(%L,true,null)$q$, un));
  update teacher_applications set status='approved' where user_id=un;
  perform t.as_super(); perform t.ok('απευθείας update της αίτησης δεν περνά', (select status from teacher_applications where user_id=un)='pending'); perform t.as_user(un);
  perform t.as_user(t1); perform t.ok('άλλος εκπαιδευτικός δεν βλέπει έγγραφα', t.n('select count(*) from teacher_documents')=0);
  perform t.as_user(adm); perform t.ok('ο διαχειριστής βλέπει το έγγραφο', t.n('select count(*) from teacher_documents')=1);
  perform t.fails('απόρριψη χωρίς λόγο', format($q$select review_application(%L,false,'')$q$, un));
  perform review_application(un,true,null);
  perform t.ok('εγκρίθηκε', (select status from teacher_applications where user_id=un)='approved');
  perform t.as_super();
  insert into teacher_applications(user_id,status,subjects) values (t1,'approved','Μαθηματικά'),(t2,'approved','Φυσική'),(t3,'approved','Χημεία');

  -- Μαθητές και ιδιωτικότητα
  perform t.as_user(t1);
  insert into students(teacher_id,full_name) values (t1,'S1') returning id into s1;
  insert into students(teacher_id,full_name) values (t1,'S2') returning id into s2;
  insert into student_notes(student_id,notes) values (s1,'ιδιωτικό');
  perform t.as_user(t2);
  insert into students(teacher_id,full_name) values (t2,'S3') returning id into s3;
  perform t.as_user(t1);
  perform t.ok('T1 βλέπει μόνο τους δικούς του', t.n('select count(*) from students')=2);
  perform t.fails('T1 δεν βάζει μαθητή σε άλλον εκπαιδευτικό', format($q$insert into students(teacher_id,full_name) values (%L,'Y')$q$, t2));

  -- Γονείς
  perform add_access(s1,'p1@x.gr','parent');
  perform add_access(s1,'newparent@x.gr','parent');
  perform t.ok('πρόσκληση για email χωρίς λογαριασμό μένει σε αναμονή', t.n('select count(*) from invites')=1);
  perform t.as_user(p1);
  perform t.ok('ο γονέας βλέπει μόνο το παιδί του', t.n('select count(*) from students')=1);
  perform t.ok('ο γονέας ΔΕΝ βλέπει σημειώσεις', t.n('select count(*) from student_notes')=0);
  perform t.fails('ο γονέας δεν κάνει add_access', format($q$select add_access(%L,'p2@x.gr','parent')$q$, s1));
  perform t.fails('ο γονέας δεν αλλάζει ρόλο', format($q$update profiles set role='admin' where id=%L$q$, p1));
  perform t.fails('ο γονέας δεν αλλάζει email', format($q$update profiles set email='t1@x.gr' where id=%L$q$, p1));
  perform t.as_user(p2); perform t.ok('ξένος γονέας δεν βλέπει μαθητές', t.n('select count(*) from students')=0);
  perform t.as_super();
  insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c9','newparent@x.gr','{"full_name":"New Parent"}');
  perform t.ok('εγγραφή με προσκεκλημένο email συνδέει αυτόματα', (select count(*) from student_parents where parent_id='00000000-0000-0000-0000-0000000000c9')=1);

  -- Συνεργασία και βοηθοί
  perform t.as_user(t1);
  perform t.fails('βοηθός χωρίς συνεργασία', format($q$select add_assistant(%L,%L)$q$, s1, t2));
  perform request_collab(t2);
  perform t.as_user(t2);
  select id into cid from teacher_collabs where to_teacher=t2;
  perform respond_collab(cid,true);
  perform t.as_user(t1);
  perform add_assistant(s1,t2);
  perform t.fails('μη εγκεκριμένος ως βοηθός', format($q$select add_assistant(%L,%L)$q$, s1, '00000000-0000-0000-0000-0000000000b9'));
  perform t.fails('άμεση εισαγωγή βοηθού', format($q$insert into student_assistants values (%L,%L)$q$, s2, t3));
  perform t.ok('κατάλογος: 2 άλλοι εγκεκριμένοι (T2,T3,un=3)', t.n('select count(*) from teacher_directory()')=3);
  perform t.as_user(t2);
  perform t.ok('βοηθός βλέπει S1 και S3 (δικό του)', t.n('select count(*) from students')=2);
  perform t.ok('βοηθός δεν βλέπει σημειώσεις', t.n('select count(*) from student_notes')=0);
  update students set full_name='HACK' where id=s1;
  perform t.ok('βοηθός δεν αλλάζει μαθητή', (select full_name from students where id=s1)='S1');

  -- Ομαδικά μαθήματα
  perform t.as_user(t1);
  lid := create_lesson(array[s1,s2], now()+interval '1 day', now()+interval '1 day 1 hour', 'https://meet.example/x', null);
  perform t.ok('ομαδικό μάθημα με 2 μαθητές', t.n('select count(*) from lesson_students')=2);
  perform t.fails('μάθημα με μαθητή άλλου', format($q$select create_lesson(array[%L,%L]::uuid[], now()+interval '1 day', now()+interval '1 day 1 hour', null, null)$q$, s1, s3));
  perform t.fails('άκυρος σύνδεσμος', format($q$select create_lesson(array[%L]::uuid[], now()+interval '1 day', now()+interval '1 day 1 hour', 'javascript:alert(1)', null)$q$, s1));
  perform t.as_user(t2);
  perform t.fails('ο βοηθός δεν φτιάχνει μάθημα για S1', format($q$select create_lesson(array[%L]::uuid[], now(), now()+interval '1 hour', null, null)$q$, s1));
  perform t.ok('ο βοηθός βλέπει το μάθημα (S1)', t.n('select count(*) from lessons')=1);
  perform t.as_user(p1);
  perform t.ok('ο γονέας βλέπει το μάθημα', t.n('select count(*) from lessons')=1);
  perform t.ok('ο γονέας βλέπει ΜΟΝΟ τη γραμμή του παιδιού του', t.n('select count(*) from lesson_students')=1);
  perform t.as_user(p2); perform t.ok('ξένος δεν βλέπει μαθήματα', t.n('select count(*) from lessons')=0);
  perform t.as_user(t1);
  update lesson_students set status='done' where lesson_id=lid and student_id=s1;
  perform t.ok('κατάσταση ανά μαθητή', (select status from lesson_students where lesson_id=lid and student_id=s1)='done' and (select status from lesson_students where lesson_id=lid and student_id=s2)='planned');
  perform t.as_user(t3);
  perform t.fails('ξένος εκπαιδευτικός βάζει μαθητή σε δικό μου μάθημα', format($q$insert into lesson_students(lesson_id,student_id) values (%L,%L)$q$, lid, s3));

  -- Ώρες υποστήριξης
  perform t.as_user(t1);
  sess := create_support_session(t2, array[s1], now()+interval '2 day', now()+interval '2 day 1 hour', 'διόρθωση');
  perform t.fails('βοηθός όχι ανατεθειμένος στον S2', format($q$select create_support_session(%L, array[%L]::uuid[], now(), now()+interval '1 hour', null)$q$, t2, s2));
  perform t.as_user(t2);
  update support_sessions set status='done' where id=sess;
  perform t.ok('ο βοηθός ολοκληρώνει την ώρα του', (select status from support_sessions where id=sess)='done');
  perform t.fails('ο βοηθός δεν μετακινεί την ώρα', format($q$update support_sessions set starts_at=starts_at+interval '1 hour' where id=%L$q$, sess));
  perform t.as_user(p1); perform t.ok('ο γονέας βλέπει την ώρα υποστήριξης του παιδιού', t.n('select count(*) from support_sessions')=1);
  perform t.as_user(p2); perform t.ok('ξένος δεν βλέπει ώρες υποστήριξης', t.n('select count(*) from support_sessions')=0);

  -- Αιτήματα γονέων
  perform t.as_user(p2);
  rid := send_interest(t1,'Παιδί Β','Γ΄ Λυκείου','Θέλω μαθήματα');
  perform t.fails('διπλό αίτημα', format($q$select send_interest(%L,'Ξ',null,null)$q$, t1));
  perform t.fails('αίτημα σε μη εγκεκριμένο', format($q$select send_interest(%L,'Ξ',null,null)$q$, '00000000-0000-0000-0000-0000000000b9'));
  perform t.as_user(t2); perform t.ok('άλλος εκπαιδευτικός δεν βλέπει το αίτημα', t.n('select count(*) from interest_requests')=0);
  perform t.as_user(t1);
  perform t.ok('ο εκπαιδευτικός βλέπει το προφίλ του γονέα που τον ζήτησε', t.n(format($q$select count(*) from profiles where id=%L$q$, p2))=1);
  perform respond_interest(rid,true);
  perform t.ok('αποδοχή δημιουργεί μαθητή', t.n('select count(*) from students')=3);
  perform t.as_user(p2); perform t.ok('ο γονέας βλέπει το νέο παιδί', t.n('select count(*) from students')=1);
  perform t.fails('ο εκπαιδευτικός δεν απαντά σε ξένο αίτημα', format($q$select respond_interest(%L,true)$q$, rid));

  -- Ονόματα και κατάλογος
  perform t.as_user(p1);
  perform t.ok('names_for: γονέας βλέπει όνομα εκπαιδευτικού του παιδιού', t.n(format($q$select count(*) from names_for(array[%L]::uuid[])$q$, t1))=1);
  perform t.ok('names_for: ΟΧΙ άσχετο όνομα', t.n(format($q$select count(*) from names_for(array[%L]::uuid[])$q$, t3))=0);
  perform t.ok('κατάλογος για γονέα: 4 εγκεκριμένοι', t.n('select count(*) from teacher_directory()')=4);

  -- Δωμάτιο σύγχρονης εκπαίδευσης
  perform t.as_super();
  insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d1','u2@x.gr','{"full_name":"Unapproved Two","account_type":"teacher"}');
  update teacher_applications set room_url='https://meet.example/t3' where user_id=t3;
  perform t.as_user(t1);
  perform save_room('https://meet.example/room-t1');
  perform t.fails('δωμάτιο χωρίς https', $q$select save_room('http://x.gr')$q$);
  perform t.fails('δωμάτιο javascript:', $q$select save_room('javascript:alert(1)')$q$);
  perform t.as_user('00000000-0000-0000-0000-0000000000d1');
  perform t.fails('μη εγκεκριμένος δεν ορίζει δωμάτιο', $q$select save_room('https://meet.example/x')$q$);
  perform t.as_user(p1);
  perform t.ok('ο γονέας βλέπει το δωμάτιο του εκπαιδευτικού του παιδιού', t.n(format($q$select count(*) from rooms_for(array[%L]::uuid[])$q$, t1))=1);
  perform t.ok('ο γονέας ΔΕΝ βλέπει δωμάτιο άσχετου εκπαιδευτικού', t.n(format($q$select count(*) from rooms_for(array[%L]::uuid[])$q$, t3))=0);
  perform t.as_user(p3);
  perform t.ok('άσχετος χρήστης ΔΕΝ βλέπει κανένα δωμάτιο', t.n(format($q$select count(*) from rooms_for(array[%L,%L]::uuid[])$q$, t1, t3))=0);
  perform t.fails('ο γονέας δεν ορίζει δωμάτιο', $q$select save_room('https://meet.example/y')$q$);
  perform t.as_super(); reset role; set local role anon;
  perform t.fails('ανώνυμος: δωμάτια', format($q$select * from rooms_for(array[%L]::uuid[])$q$, t1));
  perform t.as_super();

  -- Λήξη συνεργασίας
  perform t.as_user(t1);
  select id into cid from teacher_collabs limit 1;
  perform remove_collab(cid);
  perform t.ok('λήξη συνεργασίας αφαιρεί τον βοηθό', t.n('select count(*) from student_assistants')=0);

  -- Αιτήματα: μόνο γονείς και ενήλικοι μαθητές (can_request)
  perform t.as_user(p1);
  perform t.fails('ανήλικος μαθητής δεν στέλνει αίτημα', format($q$select send_interest(%L,'Ξ',null,null)$q$, t2));
  perform t.fails('ο χρήστης δεν δίνει στον εαυτό του δικαίωμα αιτημάτων', format($q$update profiles set can_request=true where id=%L$q$, p1));
  perform t.as_super();
  perform t.ok('η επιλογή family δίνει can_request', (select can_request from profiles where id=p2));
  perform t.ok('η επιλογή student δεν δίνει can_request', not (select can_request from profiles where id=p1));
  perform t.as_user(adm);
  update profiles set can_request=true where id=p1;
  perform t.as_super(); perform t.ok('ο διαχειριστής δίνει can_request', (select can_request from profiles where id=p1));
  update profiles set can_request=false where id=p1;

  -- Διαθεσιμότητα
  perform t.as_user(t3);
  update profiles set accepting_requests=false where id=t3;
  perform t.ok('ο εκπαιδευτικός αλλάζει τη διαθεσιμότητά του', not (select accepting_requests from profiles where id=t3));
  perform t.as_user(p2);
  perform t.fails('αίτημα σε εκπαιδευτικό που δεν δέχεται', format($q$select send_interest(%L,'Ξ',null,null)$q$, t3));
  perform t.ok('ο κατάλογος δείχνει ότι δεν δέχεται', t.n(format($q$select count(*) from teacher_directory() where id=%L and not accepting_requests$q$, t3))=1);
  perform t.as_user(t3);
  update profiles set accepting_requests=true, accepting_collabs=false where id=t3;
  perform t.as_user(t2);
  perform t.fails('πρόσκληση σε εκπαιδευτικό που δεν δέχεται συνεργασίες', format($q$select request_collab(%L)$q$, t3));
  perform t.as_user(t3);
  update profiles set accepting_collabs=true where id=t3;
  perform t.as_user(t2);
  update profiles set accepting_requests=false where id=t1;
  perform t.as_super(); perform t.ok('δεν αλλάζει τη διαθεσιμότητα άλλου', (select accepting_requests from profiles where id=t1));
  perform t.as_user(p2);
  perform send_interest(t3,'Παιδί Γ',null,null);
  perform t.as_user(t3);
  perform t.ok('αίτημα όταν ξανάνοιξε η διαθεσιμότητα', t.n('select count(*) from interest_requests')=1);

  -- Ραντεβού γνωριμίας και συναντήσεις γονέων
  perform t.as_user(t1);
  mid := create_meeting(p2,'intro',null, now()+interval '1 day', now()+interval '1 day 30 minutes', null, 'Γνωριμία');
  perform t.ok('γνωριμία μετά από αποδεκτό αίτημα', mid is not null);
  perform t.fails('γνωριμία χωρίς αίτημα', format($q$select create_meeting(%L,'intro',null, now()+interval '1 day', now()+interval '1 day 1 hour', null, null)$q$, p1));
  perform t.fails('γνωριμία με άκυρη διάρκεια', format($q$select create_meeting(%L,'intro',null, now()+interval '1 day', now()+interval '2 days', null, null)$q$, p2));
  perform t.fails('ραντεβού με javascript:', format($q$select create_meeting(%L,'intro',null, now()+interval '1 day', now()+interval '1 day 1 hour', 'javascript:alert(1)', null)$q$, p2));
  perform t.as_user(t2);
  perform t.fails('γνωριμία από άλλον εκπαιδευτικό χωρίς αίτημα', format($q$select create_meeting(%L,'intro',null, now()+interval '1 day', now()+interval '1 day 1 hour', null, null)$q$, p2));
  perform t.ok('άλλος εκπαιδευτικός δεν βλέπει το ραντεβού', t.n('select count(*) from meetings')=0);
  perform t.as_user(t1);
  perform create_meeting(p1,'parent',s1, now()+interval '2 days', now()+interval '2 days 1 hour', 'https://meet.example/g', 'Πρόοδος');
  perform t.fails('συνάντηση με γονέα άσχετου μαθητή', format($q$select create_meeting(%L,'parent',%L, now()+interval '2 days', now()+interval '2 days 1 hour', null, null)$q$, p2, s1));
  perform t.fails('συνάντηση γονέα χωρίς μαθητή', format($q$select create_meeting(%L,'parent',null, now()+interval '2 days', now()+interval '2 days 1 hour', null, null)$q$, p1));
  perform t.fails('άμεσο insert ραντεβού', format($q$insert into meetings(teacher_id,guest_id,kind,starts_at,ends_at) values (%L,%L,'intro',now(),now()+interval '1 hour')$q$, t1, p3));
  perform t.ok('ο εκπαιδευτικός βλέπει 2 ραντεβού', t.n('select count(*) from meetings')=2);
  perform t.fails('δεν αλλάζει ο καλεσμένος', format($q$update meetings set guest_id=%L where id=%L$q$, p3, mid));
  update meetings set status='done' where id=mid;
  perform t.ok('ο εκπαιδευτικός αλλάζει κατάσταση', (select status from meetings where id=mid)='done');
  perform t.as_user(p2);
  perform t.ok('ο γονέας βλέπει μόνο το δικό του ραντεβού', t.n('select count(*) from meetings')=1);
  perform t.ok('ο γονέας βλέπει το όνομα και το δωμάτιο του εκπαιδευτικού', t.n(format($q$select count(*) from names_for(array[%L]::uuid[])$q$, t1))=1);
  update meetings set status='cancelled' where id=mid;
  perform t.as_super(); perform t.ok('ο γονέας δεν αλλάζει ραντεβού', (select status from meetings where id=mid)='done'); perform t.as_user(p2);
  delete from meetings where id=mid;
  perform t.as_super(); perform t.ok('ο γονέας δεν σβήνει ραντεβού', (select count(*) from meetings where id=mid)=1);
  perform t.as_user(p3); perform t.ok('άσχετος δεν βλέπει ραντεβού', t.n('select count(*) from meetings')=0);
  perform t.as_user(p1); perform t.ok('ο άλλος γονέας βλέπει μόνο τη δική του συνάντηση', t.n('select count(*) from meetings')=1);
  perform t.as_user('00000000-0000-0000-0000-0000000000d1');
  perform t.fails('βοηθητικός εκπαιδευτικός δεν κλείνει ραντεβού', format($q$select create_meeting(%L,'intro',null, now()+interval '1 day', now()+interval '1 day 1 hour', null, null)$q$, p2));

  -- Βοηθητικοί εκπαιδευτικοί (χωρίς έγκριση διδασκαλίας)
  perform t.as_super();
  insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d2','u3@x.gr','{"full_name":"Unapproved Three","account_type":"teacher"}');
  perform t.as_user('00000000-0000-0000-0000-0000000000d1');
  perform t.ok('ο βοηθητικός βλέπει τους 4 εγκεκριμένους στον κατάλογο', t.n('select count(*) from teacher_directory() where approved')=4);
  perform t.ok('ο βοηθητικός ΔΕΝ βλέπει άλλον βοηθητικό', t.n(format($q$select count(*) from teacher_directory() where id=%L$q$, '00000000-0000-0000-0000-0000000000d2'))=0);
  perform t.fails('βοηθητικός δεν προσθέτει μαθητή', $q$insert into students(teacher_id,full_name) values ('00000000-0000-0000-0000-0000000000d1','X')$q$);
  perform t.fails('βοηθητικός δεν φτιάχνει μάθημα', $q$select create_lesson(array[]::uuid[], now(), now()+interval '1 hour', null, null)$q$);
  perform t.fails('βοηθητικός δεν συνεργάζεται με άλλον βοηθητικό', format($q$select request_collab(%L)$q$, '00000000-0000-0000-0000-0000000000d2'));
  perform request_collab(t1);
  perform t.fails('ο αποστολέας δεν δέχεται τη δική του πρόσκληση', format($q$select respond_collab((select id from teacher_collabs where from_teacher=%L),true)$q$, '00000000-0000-0000-0000-0000000000d1'));
  perform t.as_user('00000000-0000-0000-0000-0000000000d2');
  perform t.ok('ο άλλος βοηθητικός δεν βλέπει τον πρώτο', t.n(format($q$select count(*) from teacher_directory() where id=%L$q$, '00000000-0000-0000-0000-0000000000d1'))=0);
  perform t.as_user(t1);
  perform t.ok('ο εγκεκριμένος βλέπει τον βοηθητικό στον κατάλογο', t.n(format($q$select count(*) from teacher_directory() where id=%L and not approved$q$, '00000000-0000-0000-0000-0000000000d1'))=1);
  perform t.fails('βοηθός χωρίς αποδεκτή συνεργασία', format($q$select add_assistant(%L,%L)$q$, s1, '00000000-0000-0000-0000-0000000000d1'));
  select id into cid from teacher_collabs where from_teacher='00000000-0000-0000-0000-0000000000d1';
  perform respond_collab(cid,true);
  perform add_assistant(s1,'00000000-0000-0000-0000-0000000000d1');
  perform t.ok('ο βοηθητικός ορίστηκε βοηθός', t.n(format($q$select count(*) from student_assistants where assistant_id=%L$q$, '00000000-0000-0000-0000-0000000000d1'))=1);
  perform create_support_session('00000000-0000-0000-0000-0000000000d1', array[s1], now()+interval '3 days', now()+interval '3 days 1 hour', null);
  perform t.as_user(p2);
  perform t.ok('ο γονέας δεν βλέπει βοηθητικούς στον κατάλογο', t.n(format($q$select count(*) from teacher_directory() where id=%L$q$, '00000000-0000-0000-0000-0000000000d1'))=0);
  perform t.fails('ο γονέας δεν στέλνει πρόσκληση συνεργασίας', format($q$select request_collab(%L)$q$, t1));
  perform t.as_user('00000000-0000-0000-0000-0000000000d1');
  perform t.ok('ο βοηθητικός βλέπει τον μαθητή που βοηθά', t.n('select count(*) from students')=1);
  perform t.ok('ο βοηθητικός βλέπει τη δική του ώρα υποστήριξης', t.n(format($q$select count(*) from support_sessions where assistant_id=%L$q$, '00000000-0000-0000-0000-0000000000d1'))=1);
  perform t.ok('βλέπει και τις ώρες άλλων βοηθών για τον ίδιο μαθητή', t.n('select count(*) from support_sessions')=2);
  perform t.fails('ο βοηθητικός δεν φτιάχνει ώρα υποστήριξης', format($q$select create_support_session(%L, array[%L]::uuid[], now(), now()+interval '1 hour', null)$q$, '00000000-0000-0000-0000-0000000000d1', s1));

  -- Νέος μαθητής με email (πρόσκληση για ορισμό κωδικού)
  perform t.as_user(t1);
  select x.student_id into mid from add_student_invite('Νέος Μαθητής','Nea@X.gr','Α Γυμνασίου') x where x.send_invite;
  perform t.ok('νέος μαθητής: ζητά αποστολή email όταν δεν υπάρχει λογαριασμός', mid is not null);
  perform t.ok('ο μαθητής ανήκει στον εκπαιδευτικό', (select teacher_id from students where id=mid)=t1);
  perform t.ok('καταχωρήθηκε πρόσκληση με πεζά γράμματα', t.n(format($q$select count(*) from invites where student_id=%L and email='nea@x.gr'$q$, mid))=1);
  perform t.ok('εκκρεμής πρόσκληση: επιστρέφεται το email', pending_student_invite(mid)='nea@x.gr');
  perform t.as_user(t2);
  perform t.fails('άλλος εκπαιδευτικός δεν βλέπει εκκρεμή πρόσκληση', format($q$select pending_student_invite(%L)$q$, mid));
  perform t.as_user(t1);
  select x.student_id into rid from add_student_invite('Με Λογαριασμό','p1@x.gr',null) x where not x.send_invite;
  perform t.ok('υπάρχον email: συνδέεται αμέσως, χωρίς email πρόσκλησης', rid is not null and (select user_id from students where id=rid)=p1);
  perform t.fails('άκυρο email', $q$select * from add_student_invite('Χ','όχι-email',null)$q$);
  perform t.fails('κενό όνομα', $q$select * from add_student_invite('  ','ok@x.gr',null)$q$);
  perform t.as_user('00000000-0000-0000-0000-0000000000d1');
  perform t.fails('βοηθητικός δεν προσθέτει μαθητή με email', $q$select * from add_student_invite('Χ','ok2@x.gr',null)$q$);
  perform t.as_user(p2);
  perform t.fails('γονέας δεν προσθέτει μαθητή με email', $q$select * from add_student_invite('Χ','ok3@x.gr',null)$q$);
  perform t.as_super();
  -- Ο χρήστης δημιουργείται από πρόσκληση (invited=true): εκκρεμής μέχρι να ορίσει κωδικό
  insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1','nea@x.gr','{"full_name":"Νέος Μαθητής","account_type":"student","invited":"true"}');
  perform t.ok('προσκεκλημένος: password_set = false', not (select password_set from profiles where id='00000000-0000-0000-0000-0000000000e1'));
  perform t.ok('προσκεκλημένος: συνδέθηκε με τον μαθητή', (select user_id from students where id=mid)='00000000-0000-0000-0000-0000000000e1');
  perform t.ok('η πρόσκληση σβήστηκε μετά τη σύνδεση', t.n(format($q$select count(*) from invites where student_id=%L$q$, mid))=0);
  perform t.ok('κανονική εγγραφή: password_set = true', (select password_set from profiles where id=p1));
  perform t.as_user(t1);
  perform t.ok('ο εκπαιδευτικός βλέπει ότι ο μαθητής είναι σε εκκρεμότητα', t.n(format($q$select count(*) from profiles where id=%L and not password_set$q$, '00000000-0000-0000-0000-0000000000e1'))=1);
  perform t.as_user('00000000-0000-0000-0000-0000000000e1');
  update profiles set password_set=true where id='00000000-0000-0000-0000-0000000000e1';
  perform t.as_super(); perform t.ok('ο μαθητής ενεργοποιείται όταν ορίσει κωδικό', (select password_set from profiles where id='00000000-0000-0000-0000-0000000000e1'));
  perform t.as_user('00000000-0000-0000-0000-0000000000e1');
  perform t.fails('ο μαθητής δεν αλλάζει ρόλο', format($q$update profiles set role='teacher' where id=%L$q$, '00000000-0000-0000-0000-0000000000e1'));
  -- Όριο εκκρεμών προσκλήσεων
  perform t.as_user(t3);
  for n in 1..30 loop
    perform add_student_invite('Μαζικός '||n, 'bulk'||n||'@x.gr', null);
  end loop;
  perform t.fails('όριο 30 εκκρεμών προσκλήσεων', $q$select * from add_student_invite('Ένας ακόμη','bulk31@x.gr',null)$q$);
  perform t.as_super(); reset role; set local role anon;
  perform t.fails('ανώνυμος: add_student_invite', $q$select * from add_student_invite('Χ','a@x.gr',null)$q$);

  -- Ανώνυμος και Storage
  perform t.as_super(); reset role; set local role anon;
  perform t.fails('ανώνυμος: κατάλογος', 'select * from teacher_directory()');
  perform t.ok('ανώνυμος: δεν βλέπει προφίλ', t.n('select count(*) from profiles')=0);
  perform t.as_user(un);
  insert into storage.objects(bucket_id,name) values ('credentials', un||'/a.pdf');
  perform t.fails('αρχείο σε ξένο φάκελο', format($q$insert into storage.objects(bucket_id,name) values ('credentials', %L)$q$, t1||'/a.pdf'));
  perform t.as_user(t1); perform t.ok('ξένος δεν βλέπει αρχεία πιστοποιητικών', t.n('select count(*) from storage.objects')=0);
  perform t.as_user(adm); perform t.ok('ο διαχειριστής βλέπει αρχεία', t.n('select count(*) from storage.objects')=1);
end $$;
