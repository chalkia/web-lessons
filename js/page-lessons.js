// Μαθήματα: αρχική, ημερολόγιο/παρουσιολόγιο (ομαδικά μαθήματα, ώρες υποστήριξης βοηθών), προσωπικό ημερολόγιο.
(function () {
  'use strict';
  if (!window.App || !App.ready) { return; }

  var sb = App.sb, must = App.must, esc = App.esc, view = App.view, fmt = App.fmt, hours = App.hours;
  var NO_MATCH = '00000000-0000-0000-0000-000000000000'; // για φίλτρο .in() χωρίς αποτελέσματα

  function uniqIds(list) {
    var out = [];
    list.forEach(function (x) { if (x && out.indexOf(x) === -1) { out.push(x); } });
    return out;
  }

  // ---------- Αρχική ----------

  App.pages.home = async function () {
    App.renderNav('home');
    var st = App.state;
    var role = st.profile.role;
    var me = st.profile.id;
    var nowIso = new Date().toISOString();

    var lessons = await must(sb.from('lessons')
      .select('id, teacher_id, starts_at, ends_at, meeting_url, lesson_students(student_id, status, students(full_name))')
      .gte('ends_at', nowIso).order('starts_at').limit(15));
    // Μόνο μαθήματα όπου κάποιος ορατός μαθητής είναι «προγραμματισμένος».
    var upcoming = lessons.filter(function (l) {
      return l.lesson_students.some(function (x) { return x.status === 'planned'; });
    }).slice(0, 3);
    var sessions = await must(sb.from('support_sessions')
      .select('id, teacher_id, assistant_id, starts_at, ends_at, status, support_session_students(students(full_name))')
      .eq('status', 'planned').gte('ends_at', nowIso).order('starts_at').limit(3));
    var meets = await must(sb.from('meetings')
      .select('id, teacher_id, guest_id, kind, starts_at, ends_at, meeting_url')
      .eq('status', 'planned').gte('ends_at', nowIso).order('starts_at').limit(3));
    var events = await must(sb.from('personal_events')
      .select('id, title, due_at').eq('done', false).order('due_at').limit(5));

    var hostIds = uniqIds(upcoming.map(function (l) { return l.teacher_id; })
      .concat(sessions.map(function (s) { return s.assistant_id; }))
      .concat(meets.map(function (m) { return m.teacher_id; })).concat([me]));
    var rooms = await App.rooms(hostIds);
    var names = await App.names(hostIds.concat(sessions.map(function (s) { return s.teacher_id; }))
      .concat(meets.map(function (m) { return m.guest_id; })));

    var tiles = '';
    if (role === 'teacher' && !App.canTeach()) {
      tiles += '<a class="tile" href="#/credentials"><strong>Πιστοποιητικά και έγκριση</strong><span>Είσαι βοηθητικός· για δικούς σου μαθητές χρειάζεται έγκριση</span></a>';
    }
    if (App.canTeach() || role === 'teacher') {
      tiles += '<a class="tile" href="#/students"><strong>Μαθητές</strong><span>' + (App.canTeach() ? 'Μαθητές, γονείς και βοηθοί' : 'Μαθητές όπου είσαι βοηθός') + '</span></a>';
    }
    if (role === 'teacher') {
      if (App.canTeach()) {
        tiles += '<a class="tile" href="#/requests"><strong>Αιτήματα</strong><span>Γονείς που ζητούν συνεργασία</span></a>';
      }
      tiles += '<a class="tile" href="#/teachers"><strong>Συνεργάτες</strong><span>Άλλοι εκπαιδευτικοί και βοηθοί</span></a>';
    }
    if (App.canRequest()) {
      tiles += '<a class="tile" href="#/teachers"><strong>Εκπαιδευτικοί</strong><span>Βρες εκπαιδευτικό και στείλε αίτημα</span></a>';
    }
    tiles += '<a class="tile" href="#/calendar"><strong>Ημερολόγιο / Παρουσιολόγιο</strong><span>Προγραμματισμένες και πραγματοποιημένες ώρες</span></a>';
    tiles += '<a class="tile" href="#/personal"><strong>Προσωπικό ημερολόγιο</strong><span>Οι επόμενες υποχρεώσεις σου</span></a>';
    if (role === 'admin') {
      tiles += '<a class="tile" href="#/approvals"><strong>Εγκρίσεις</strong><span>Αιτήσεις εκπαιδευτικών</span></a>';
      tiles += '<a class="tile" href="#/users"><strong>Χρήστες</strong><span>Ρόλοι και εποπτεία</span></a>';
    }

    var roomCard = '';
    if (role === 'teacher' && App.canTeach()) {
      roomCard = '<div class="card"><h2>Το δωμάτιό μου</h2>' +
        '<p class="muted">Φτιάξε το δωμάτιο στην πλατφόρμα που προτιμάς (Meet, Zoom, Jitsi, Teams κ.λπ.) και βάλε εδώ τον μόνιμο σύνδεσμό του. ' +
        'Οι μαθητές, οι γονείς και οι βοηθοί σου μπαίνουν με το κουμπί «Σύνδεση», σε νέο παράθυρο.</p>' +
        '<form data-form="save-room" class="row">' +
        '<div><label for="room-url">Σύνδεσμος δωματίου (https://…)</label>' +
        '<input id="room-url" name="url" type="url" maxlength="500" value="' + esc(rooms[me] || '') + '" placeholder="https://meet.jit.si/το-δωμάτιό-μου"></div>' +
        '<button class="primary" type="submit">Αποθήκευση</button></form>' +
        (rooms[me] ? '<p>' + App.joinButton(App.safeUrl(rooms[me])) + ' <span class="muted">Δοκιμή του δωματίου σου</span></p>' : '') +
        '</div>';
    }

    var nextHtml;
    if (!upcoming.length && !sessions.length && !meets.length) {
      nextHtml = '<p class="empty">Δεν υπάρχει προγραμματισμένο μάθημα.</p>';
    } else {
      nextHtml = '<table><tbody>' + upcoming.map(function (l) {
        var who = l.lesson_students.map(function (x) { return x.students ? x.students.full_name : ''; }).join(', ');
        return '<tr><td><strong>' + esc(fmt(l.starts_at)) + '</strong></td><td>' + esc(who) + '</td>' +
          '<td>' + App.joinButton(App.joinUrl(l, rooms, l.teacher_id)) + '</td></tr>';
      }).join('') + sessions.map(function (s) {
        var who = s.support_session_students.map(function (x) { return x.students ? x.students.full_name : ''; }).join(', ');
        return '<tr><td><strong>' + esc(fmt(s.starts_at)) + '</strong></td>' +
          '<td>Υποστήριξη: ' + esc(who) + ' <span class="muted">(' + esc(names[s.assistant_id] || 'βοηθός') + ')</span></td>' +
          '<td>' + App.joinButton(App.joinUrl(s, rooms, s.assistant_id) || App.joinUrl(s, rooms, s.teacher_id)) + '</td></tr>';
      }).join('') + meets.map(function (m) {
        var other = m.guest_id === me ? names[m.teacher_id] : names[m.guest_id];
        return '<tr><td><strong>' + esc(fmt(m.starts_at)) + '</strong></td>' +
          '<td>' + esc(App.MEETING_KIND[m.kind]) + ': ' + esc(other || '') + '</td>' +
          '<td>' + App.joinButton(App.joinUrl(m, rooms, m.teacher_id)) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }

    view.innerHTML =
      '<h1>Καλώς ήρθες, ' + esc(st.profile.full_name) + '</h1>' +
      '<div class="grid" style="margin-bottom:16px">' + tiles + '</div>' +
      roomCard +
      '<div class="card"><h2>Επόμενα μαθήματα</h2>' + nextHtml + '</div>' +
      '<div class="card"><h2>Επόμενες υποχρεώσεις</h2>' +
      (events.length
        ? '<table><tbody>' + events.map(function (e) {
          return '<tr><td>' + esc(fmt(e.due_at)) + '</td><td>' + esc(e.title) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Καμία υποχρέωση.</p>') +
      '</div>';
  };

  App.forms['save-room'] = async function (f) {
    await must(sb.rpc('save_room', { p_url: f.elements['url'].value.trim() }));
    App.toast('Το δωμάτιο αποθηκεύτηκε.');
    await App.pages.home();
  };

  // ---------- Ημερολόγιο / παρουσιολόγιο ----------

  var calFilter = { student: '', period: 'upcoming' };

  function studentList(rows) {
    return rows.map(function (x) { return x.students ? x.students.full_name : ''; }).join(', ');
  }

  // Εμφανίζει στη φόρμα υποστήριξης μόνο τους μαθητές του επιλεγμένου βοηθού.
  function filterSupportStudents() {
    var form = document.querySelector('form[data-form="add-support"]');
    if (!form) { return; }
    var a = form.elements['assistant'].value;
    Array.prototype.forEach.call(form.querySelectorAll('label[data-assistants]'), function (lab) {
      var ok = lab.getAttribute('data-assistants').split(',').indexOf(a) !== -1;
      lab.hidden = !ok;
      if (!ok) { lab.querySelector('input').checked = false; }
    });
  }

  App.pages.calendar = async function () {
    App.renderNav('calendar');
    var me = App.state.profile.id;
    var write = App.canTeach();
    var students = await must(sb.from('students').select('id, full_name, teacher_id').order('full_name'));
    var nowIso = new Date().toISOString();
    var asc = calFilter.period !== 'past';

    var lq = sb.from('lessons')
      .select('id, teacher_id, starts_at, ends_at, meeting_url, notes, lesson_students(student_id, status, students(full_name))')
      .order('starts_at', { ascending: asc });
    var sq = sb.from('support_sessions')
      .select('id, teacher_id, assistant_id, starts_at, ends_at, status, notes, support_session_students(student_id, students(full_name))')
      .order('starts_at', { ascending: asc });
    if (calFilter.period === 'upcoming') { lq = lq.gte('ends_at', nowIso); sq = sq.gte('ends_at', nowIso); }
    if (calFilter.period === 'past') { lq = lq.lt('ends_at', nowIso); sq = sq.lt('ends_at', nowIso); }
    if (calFilter.student) {
      var lr = await must(sb.from('lesson_students').select('lesson_id').eq('student_id', calFilter.student));
      var sr = await must(sb.from('support_session_students').select('session_id').eq('student_id', calFilter.student));
      var lids = lr.map(function (x) { return x.lesson_id; });
      var sids = sr.map(function (x) { return x.session_id; });
      lq = lq.in('id', lids.length ? lids : [NO_MATCH]);
      sq = sq.in('id', sids.length ? sids : [NO_MATCH]);
    }
    var lessons = await must(lq.limit(300));
    var sessions = await must(sq.limit(300));

    var mq = sb.from('meetings')
      .select('id, teacher_id, guest_id, kind, student_id, starts_at, ends_at, meeting_url, status, notes, students(full_name)')
      .order('starts_at', { ascending: asc });
    if (calFilter.period === 'upcoming') { mq = mq.gte('ends_at', nowIso); }
    if (calFilter.period === 'past') { mq = mq.lt('ends_at', nowIso); }
    if (calFilter.student) { mq = mq.eq('student_id', calFilter.student); }
    var meetings = await must(mq.limit(300));

    var hostIds = uniqIds(lessons.map(function (l) { return l.teacher_id; })
      .concat(sessions.map(function (s) { return s.assistant_id; }))
      .concat(sessions.map(function (s) { return s.teacher_id; }))
      .concat(meetings.map(function (m) { return m.teacher_id; }))
      .concat(meetings.map(function (m) { return m.guest_id; })));
    var rooms = await App.rooms(hostIds);
    var names = await App.names(hostIds);

    // Σύνοψη ωρών ανά μαθητή (από όσα βλέπω) και ανά βοηθό.
    var sum = {};
    lessons.forEach(function (l) {
      l.lesson_students.forEach(function (x) {
        var n = x.students ? x.students.full_name : '—';
        if (!sum[n]) { sum[n] = { planned: 0, done: 0, absent: 0, cancelled: 0 }; }
        sum[n][x.status] += hours(l);
      });
    });
    var sup = {};
    sessions.forEach(function (s) {
      var n = names[s.assistant_id] || 'Βοηθός';
      if (!sup[n]) { sup[n] = { planned: 0, done: 0 }; }
      if (s.status === 'planned' || s.status === 'done') { sup[n][s.status] += hours(s); }
    });

    var mineStudents = students.filter(function (s) { return App.ownsTeacher(s.teacher_id); });
    var studentOptions = students.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === calFilter.student ? ' selected' : '') + '>' + esc(s.full_name) + '</option>';
    }).join('');

    // Βοηθοί των δικών μου μαθητών, για τη φόρμα ώρας υποστήριξης.
    var assistRows = [];
    if (write && mineStudents.length) {
      var mineIds = mineStudents.map(function (s) { return s.id; });
      assistRows = await must(sb.from('student_assistants').select('student_id, assistant_id').in('student_id', mineIds));
    }
    var assistIds = uniqIds(assistRows.map(function (r) { return r.assistant_id; }));
    var assistNames = assistIds.length ? await App.names(assistIds) : {};
    var start = App.nextHour();

    var newLesson = write
      ? '<div class="card"><h2>Νέο μάθημα</h2>' +
      '<p class="muted">Διάλεξε έναν ή περισσότερους μαθητές για ομαδικό μάθημα. Η παρουσία καταγράφεται ξεχωριστά για τον καθένα.</p>' +
      (mineStudents.length
        ? '<form data-form="add-lesson" class="spaced">' +
        '<div>' + mineStudents.map(function (s) {
          return '<label class="check"><input type="checkbox" name="students" value="' + esc(s.id) + '"> ' + esc(s.full_name) + '</label>';
        }).join('') + '</div>' +
        '<div class="row">' +
        '<div><label for="l-start">Έναρξη</label><input id="l-start" name="start" type="datetime-local" value="' + App.toLocalInput(start) + '" required></div>' +
        '<div><label for="l-dur">Διάρκεια (λεπτά)</label><input id="l-dur" name="duration" type="number" min="15" max="720" step="15" value="60" required></div>' +
        '<div><label for="l-url">Ειδικός σύνδεσμος (προαιρετικό — αλλιώς χρησιμοποιείται το δωμάτιό σου)</label><input id="l-url" name="url" type="url" placeholder="https://…"></div>' +
        '</div><button class="primary" type="submit">Προσθήκη μαθήματος</button></form>'
        : '<p class="empty">Πρόσθεσε πρώτα μαθητές.</p>') +
      '</div>'
      : '';

    // Επιλογές «μαθητής — γονέας» για συνάντηση με γονέα.
    var parentRows = [];
    if (write && mineStudents.length) {
      parentRows = await must(sb.from('student_parents').select('student_id, parent_id')
        .in('student_id', mineStudents.map(function (s) { return s.id; })));
    }
    var parentNames = parentRows.length
      ? await App.names(uniqIds(parentRows.map(function (r) { return r.parent_id; }))) : {};
    var newMeeting = '';
    if (write) {
      newMeeting = '<div class="card"><h2>Συνάντηση με γονέα</h2>' +
        '<p class="muted">Συνάντηση στην πλατφόρμα για την πρόοδο ενός μαθητή. Ο γονέας τη βλέπει στο ημερολόγιό του και μπαίνει με το κουμπί «Σύνδεση». Τα ραντεβού γνωριμίας με νέους γονείς τα κλείνεις από τη σελίδα Αιτήματα.</p>' +
        (parentRows.length
          ? '<form data-form="add-meeting" class="spaced">' +
          '<div><label for="m-who">Μαθητής — γονέας</label><select id="m-who" name="who">' +
          parentRows.map(function (r) {
            var st = mineStudents.filter(function (s) { return s.id === r.student_id; })[0];
            return '<option value="' + esc(r.student_id) + '|' + esc(r.parent_id) + '">' +
              esc(st ? st.full_name : '') + ' — ' + esc(parentNames[r.parent_id] || 'Γονέας') + '</option>';
          }).join('') + '</select></div>' +
          '<div class="row">' +
          '<div><label for="m-start">Έναρξη</label><input id="m-start" name="start" type="datetime-local" value="' + App.toLocalInput(start) + '" required></div>' +
          '<div><label for="m-dur">Διάρκεια (λεπτά)</label><input id="m-dur" name="duration" type="number" min="15" max="240" step="15" value="30" required></div>' +
          '<div><label for="m-url">Ειδικός σύνδεσμος (προαιρετικό)</label><input id="m-url" name="url" type="url" placeholder="https://…"></div>' +
          '<div><label for="m-notes">Σημείωση</label><input id="m-notes" name="notes" maxlength="500"></div>' +
          '</div><button class="primary" type="submit">Προσθήκη συνάντησης</button></form>'
          : '<p class="empty">Δεν υπάρχουν γονείς συνδεδεμένοι με τους μαθητές σου. Πρόσθεσέ τους από τη σελίδα του μαθητή.</p>') +
        '</div>';
    }

    var newSupport = '';
    if (write) {
      newSupport = '<div class="card"><h2>Ώρα υποστήριξης βοηθού</h2>' +
        '<p class="muted">Ανάθεσε στον βοηθό δική του ώρα για συγκεκριμένους μαθητές (διόρθωση γραπτών, βοήθεια σε εργασίες). Μετράει ξεχωριστά από τα μαθήματά σου.</p>' +
        (assistIds.length
          ? '<form data-form="add-support" class="spaced">' +
          '<div><label for="sp-assistant">Βοηθός</label><select id="sp-assistant" name="assistant" data-change="support-assistant">' +
          assistIds.map(function (id) { return '<option value="' + esc(id) + '">' + esc(assistNames[id] || 'Βοηθός') + '</option>'; }).join('') +
          '</select></div>' +
          '<div>' + mineStudents.filter(function (s) {
            return assistRows.some(function (r) { return r.student_id === s.id; });
          }).map(function (s) {
            var who = assistRows.filter(function (r) { return r.student_id === s.id; })
              .map(function (r) { return r.assistant_id; }).join(',');
            return '<label class="check" data-assistants="' + esc(who) + '"><input type="checkbox" name="students" value="' + esc(s.id) + '"> ' + esc(s.full_name) + '</label>';
          }).join('') + '</div>' +
          '<div class="row">' +
          '<div><label for="sp-start">Έναρξη</label><input id="sp-start" name="start" type="datetime-local" value="' + App.toLocalInput(start) + '" required></div>' +
          '<div><label for="sp-dur">Διάρκεια (λεπτά)</label><input id="sp-dur" name="duration" type="number" min="15" max="720" step="15" value="60" required></div>' +
          '<div><label for="sp-notes">Σημείωση</label><input id="sp-notes" name="notes" maxlength="500"></div>' +
          '</div><button class="primary" type="submit">Ανάθεση ώρας</button></form>'
          : '<p class="empty">Δεν έχεις ορίσει ακόμη βοηθούς. Ανάθεσε συνεργάτη ως βοηθό από τη σελίδα του μαθητή.</p>') +
        '</div>';
    }

    var now = Date.now();
    var lessonRows = lessons.map(function (l) {
      var mine = App.ownsTeacher(l.teacher_id);
      var who = l.lesson_students.map(function (x) {
        var nm = x.students ? x.students.full_name : '';
        var stat = mine
          ? '<select data-change="lesson-status" data-lesson="' + esc(l.id) + '" data-student="' + esc(x.student_id) + '">' +
          Object.keys(App.LESSON_STATUS).map(function (k) {
            return '<option value="' + k + '"' + (k === x.status ? ' selected' : '') + '>' + esc(App.LESSON_STATUS[k]) + '</option>';
          }).join('') + '</select>'
          : '<span class="badge ' + esc(x.status) + '">' + esc(App.LESSON_STATUS[x.status]) + '</span>';
        return '<div class="row-line">' + esc(nm) + ' ' + stat + '</div>';
      }).join('');
      var live = new Date(l.ends_at).getTime() > now;
      return '<tr><td>' + esc(fmt(l.starts_at)) + ' <span class="muted">(' + hours(l).toFixed(1) + ' ω)</span><br>' +
        '<span class="muted">' + esc(names[l.teacher_id] || '') + '</span></td>' +
        '<td>' + who + '</td>' +
        '<td>' + (live ? App.joinButton(App.joinUrl(l, rooms, l.teacher_id)) : '<span class="muted">—</span>') + '</td>' +
        (write ? '<td>' + (mine ? '<button class="danger" data-action="delete-lesson" data-id="' + esc(l.id) + '">Διαγραφή</button>' : '') + '</td>' : '') +
        '</tr>';
    }).join('');

    var supportRows = sessions.map(function (s) {
      var mine = App.ownsTeacher(s.teacher_id);
      var canStatus = mine || s.assistant_id === me;
      var live = new Date(s.ends_at).getTime() > now;
      var url = App.joinUrl(s, rooms, s.assistant_id) || App.joinUrl(s, rooms, s.teacher_id);
      return '<tr><td>' + esc(fmt(s.starts_at)) + ' <span class="muted">(' + hours(s).toFixed(1) + ' ω)</span></td>' +
        '<td>' + esc(names[s.assistant_id] || '') + '</td>' +
        '<td>' + esc(studentList(s.support_session_students)) + (s.notes ? '<br><span class="muted">' + esc(s.notes) + '</span>' : '') + '</td>' +
        '<td>' + (canStatus
          ? '<select data-change="support-status" data-id="' + esc(s.id) + '">' +
          Object.keys(App.SUPPORT_STATUS).map(function (k) {
            return '<option value="' + k + '"' + (k === s.status ? ' selected' : '') + '>' + esc(App.SUPPORT_STATUS[k]) + '</option>';
          }).join('') + '</select>'
          : '<span class="badge ' + esc(s.status) + '">' + esc(App.SUPPORT_STATUS[s.status]) + '</span>') + '</td>' +
        '<td>' + (live && s.status === 'planned' ? App.joinButton(url) : '<span class="muted">—</span>') + '</td>' +
        (write ? '<td>' + (mine ? '<button class="danger" data-action="delete-support" data-id="' + esc(s.id) + '">Διαγραφή</button>' : '') + '</td>' : '') +
        '</tr>';
    }).join('');

    var meetingRows = meetings.map(function (m) {
      var mine = App.ownsTeacher(m.teacher_id);
      var live = new Date(m.ends_at).getTime() > now;
      var other = m.guest_id === me ? 'Εκπαιδευτικός: ' + (names[m.teacher_id] || '') : (names[m.guest_id] || 'Καλεσμένος');
      return '<tr><td>' + esc(fmt(m.starts_at)) + ' <span class="muted">(' + hours(m).toFixed(1) + ' ω)</span></td>' +
        '<td>' + esc(App.MEETING_KIND[m.kind]) + '</td>' +
        '<td>' + esc(other) + (m.students ? '<br><span class="muted">Μαθητής: ' + esc(m.students.full_name) + '</span>' : '') +
        (m.notes ? '<br><span class="muted">' + esc(m.notes) + '</span>' : '') + '</td>' +
        '<td>' + (mine
          ? '<select data-change="meeting-status" data-id="' + esc(m.id) + '">' +
          Object.keys(App.SUPPORT_STATUS).map(function (k) {
            return '<option value="' + k + '"' + (k === m.status ? ' selected' : '') + '>' + esc(App.SUPPORT_STATUS[k]) + '</option>';
          }).join('') + '</select>'
          : '<span class="badge ' + esc(m.status) + '">' + esc(App.SUPPORT_STATUS[m.status]) + '</span>') + '</td>' +
        '<td>' + (live && m.status === 'planned' ? App.joinButton(App.joinUrl(m, rooms, m.teacher_id)) : '<span class="muted">—</span>') + '</td>' +
        (write ? '<td>' + (mine ? '<button class="danger" data-action="delete-meeting" data-id="' + esc(m.id) + '">Διαγραφή</button>' : '') + '</td>' : '') +
        '</tr>';
    }).join('');

    view.innerHTML =
      '<h1>Ημερολόγιο / Παρουσιολόγιο</h1>' + newLesson + newMeeting + newSupport +
      '<div class="card"><div class="row">' +
      '<div><label for="f-student">Μαθητής</label><select id="f-student" data-change="cal-filter-student"><option value="">Όλοι</option>' + studentOptions + '</select></div>' +
      '<div><label for="f-period">Περίοδος</label><select id="f-period" data-change="cal-filter-period">' +
      [['upcoming', 'Επόμενα'], ['past', 'Παλαιότερα'], ['all', 'Όλα']].map(function (p) {
        return '<option value="' + p[0] + '"' + (p[0] === calFilter.period ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div></div></div>' +

      '<div class="card"><h2>Σύνοψη ωρών ανά μαθητή</h2>' +
      (Object.keys(sum).length
        ? '<table><thead><tr><th>Μαθητής</th><th>Πραγματοποιήθηκαν</th><th>Προγραμματισμένες</th><th>Απουσίες</th><th>Ακυρώσεις</th></tr></thead><tbody>' +
        Object.keys(sum).map(function (n) {
          var r = sum[n];
          return '<tr><td>' + esc(n) + '</td><td>' + r.done.toFixed(1) + ' ω</td><td>' + r.planned.toFixed(1) + ' ω</td><td>' + r.absent.toFixed(1) + ' ω</td><td>' + r.cancelled.toFixed(1) + ' ω</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Δεν υπάρχουν δεδομένα.</p>') +
      '</div>' +

      '<div class="card"><h2>Μαθήματα</h2>' +
      (lessons.length
        ? '<table><thead><tr><th>Πότε</th><th>Μαθητές και παρουσία</th><th>Δωμάτιο</th>' + (write ? '<th></th>' : '') + '</tr></thead><tbody>' + lessonRows + '</tbody></table>'
        : '<p class="empty">Δεν υπάρχουν μαθήματα.</p>') +
      '</div>' +

      '<div class="card"><h2>Ραντεβού και συναντήσεις γονέων</h2>' +
      (meetings.length
        ? '<table><thead><tr><th>Πότε</th><th>Είδος</th><th>Με ποιον</th><th>Κατάσταση</th><th>Δωμάτιο</th>' + (write ? '<th></th>' : '') + '</tr></thead><tbody>' + meetingRows + '</tbody></table>'
        : '<p class="empty">Δεν υπάρχουν ραντεβού.</p>') +
      '</div>' +

      '<div class="card"><h2>Ώρες υποστήριξης βοηθών</h2>' +
      (sessions.length
        ? '<table><thead><tr><th>Πότε</th><th>Βοηθός</th><th>Μαθητές</th><th>Κατάσταση</th><th>Δωμάτιο</th>' + (write ? '<th></th>' : '') + '</tr></thead><tbody>' + supportRows + '</tbody></table>'
        : '<p class="empty">Δεν υπάρχουν ώρες υποστήριξης.</p>') +
      (Object.keys(sup).length
        ? '<h2 style="margin-top:16px">Ώρες ανά βοηθό</h2><table><thead><tr><th>Βοηθός</th><th>Πραγματοποιήθηκαν</th><th>Προγραμματισμένες</th></tr></thead><tbody>' +
        Object.keys(sup).map(function (n) {
          return '<tr><td>' + esc(n) + '</td><td>' + sup[n].done.toFixed(1) + ' ω</td><td>' + sup[n].planned.toFixed(1) + ' ω</td></tr>';
        }).join('') + '</tbody></table>'
        : '') +
      '</div>';

    filterSupportStudents();
  };

  function checkedStudents(f) {
    return Array.prototype.map.call(f.querySelectorAll('input[name="students"]:checked'), function (c) { return c.value; });
  }
  function timeRange(f) {
    var startD = new Date(f.elements['start'].value);
    if (isNaN(startD.getTime())) { throw new Error('Άκυρη ημερομηνία έναρξης.'); }
    var endD = new Date(startD.getTime() + Number(f.elements['duration'].value) * 60000);
    return { start: startD.toISOString(), end: endD.toISOString() };
  }

  App.forms['add-lesson'] = async function (f) {
    var ids = checkedStudents(f);
    if (!ids.length) { throw new Error('Διάλεξε τουλάχιστον έναν μαθητή.'); }
    var r = timeRange(f);
    await must(sb.rpc('create_lesson', {
      p_students: ids,
      p_start: r.start,
      p_end: r.end,
      p_url: f.elements['url'].value.trim(),
      p_notes: ''
    }));
    await App.pages.calendar();
  };

  App.forms['add-meeting'] = async function (f) {
    var parts = f.elements['who'].value.split('|');
    var r = timeRange(f);
    await must(sb.rpc('create_meeting', {
      p_guest: parts[1],
      p_kind: 'parent',
      p_student: parts[0],
      p_start: r.start,
      p_end: r.end,
      p_url: f.elements['url'].value.trim(),
      p_notes: f.elements['notes'].value.trim()
    }));
    await App.pages.calendar();
  };

  App.forms['add-support'] = async function (f) {
    var ids = checkedStudents(f);
    if (!ids.length) { throw new Error('Διάλεξε τουλάχιστον έναν μαθητή.'); }
    var r = timeRange(f);
    await must(sb.rpc('create_support_session', {
      p_assistant: f.elements['assistant'].value,
      p_students: ids,
      p_start: r.start,
      p_end: r.end,
      p_notes: f.elements['notes'].value.trim()
    }));
    await App.pages.calendar();
  };

  App.changes['support-assistant'] = async function () { filterSupportStudents(); };
  App.changes['cal-filter-student'] = async function (t) { calFilter.student = t.value; await App.pages.calendar(); };
  App.changes['cal-filter-period'] = async function (t) { calFilter.period = t.value; await App.pages.calendar(); };

  // Το RLS αγνοεί σιωπηλά αλλαγές που δεν επιτρέπονται· ελέγχουμε ότι πράγματι άλλαξε γραμμή.
  App.changes['lesson-status'] = async function (t) {
    var rows = await must(sb.from('lesson_students').update({ status: t.value })
      .eq('lesson_id', t.getAttribute('data-lesson')).eq('student_id', t.getAttribute('data-student')).select('lesson_id'));
    if (!rows.length) { throw new Error('Η αλλαγή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };
  App.changes['support-status'] = async function (t) {
    var rows = await must(sb.from('support_sessions').update({ status: t.value })
      .eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η αλλαγή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };

  App.changes['meeting-status'] = async function (t) {
    var rows = await must(sb.from('meetings').update({ status: t.value })
      .eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η αλλαγή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };
  App.actions['delete-meeting'] = async function (t) {
    if (!confirm('Διαγραφή ραντεβού;')) { return; }
    var rows = await must(sb.from('meetings').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η διαγραφή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };
  App.actions['delete-lesson'] = async function (t) {
    if (!confirm('Διαγραφή μαθήματος για όλους τους μαθητές του;')) { return; }
    var rows = await must(sb.from('lessons').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η διαγραφή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };
  App.actions['delete-support'] = async function (t) {
    if (!confirm('Διαγραφή ώρας υποστήριξης;')) { return; }
    var rows = await must(sb.from('support_sessions').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η διαγραφή δεν εφαρμόστηκε.'); }
    await App.pages.calendar();
  };

  // ---------- Προσωπικό ημερολόγιο ----------

  App.pages.personal = async function () {
    App.renderNav('personal');
    var events = await must(sb.from('personal_events').select('id, title, due_at, done').order('due_at'));
    view.innerHTML =
      '<h1>Προσωπικό ημερολόγιο</h1>' +
      '<div class="card"><form data-form="add-event" class="row">' +
      '<div><label for="p-title">Υποχρέωση</label><input id="p-title" name="title" required></div>' +
      '<div><label for="p-due">Πότε</label><input id="p-due" name="due" type="datetime-local" value="' + App.toLocalInput(App.nextHour()) + '" required></div>' +
      '<button class="primary" type="submit">Προσθήκη</button></form></div>' +
      '<div class="card">' +
      (events.length
        ? '<table><tbody>' + events.map(function (e) {
          return '<tr><td style="width:32px"><input type="checkbox" data-change="toggle-event" data-id="' + esc(e.id) + '"' + (e.done ? ' checked' : '') + ' aria-label="Ολοκληρώθηκε"></td>' +
            '<td>' + esc(fmt(e.due_at)) + '</td>' +
            '<td' + (e.done ? ' class="muted"' : '') + '>' + esc(e.title) + '</td>' +
            '<td><button class="danger" data-action="delete-event" data-id="' + esc(e.id) + '">Διαγραφή</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Καμία υποχρέωση.</p>') +
      '</div>';
  };

  App.forms['add-event'] = async function (f) {
    await must(sb.from('personal_events').insert({
      user_id: App.state.profile.id,
      title: f.elements['title'].value.trim(),
      due_at: new Date(f.elements['due'].value).toISOString()
    }));
    await App.pages.personal();
  };
  App.changes['toggle-event'] = async function (t) {
    await must(sb.from('personal_events').update({ done: t.checked }).eq('id', t.getAttribute('data-id')));
    await App.pages.personal();
  };
  App.actions['delete-event'] = async function (t) {
    await must(sb.from('personal_events').delete().eq('id', t.getAttribute('data-id')));
    await App.pages.personal();
  };
})();
