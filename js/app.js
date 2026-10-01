(function () {
  'use strict';

  // ---------- Βοηθητικά ----------

  // Αν λείπει στοιχείο, σταματά με σαφές μήνυμα (όχι σιωπηλό undefined).
  function el(id) {
    var node = document.getElementById(id);
    if (!node) { throw new Error('Λείπει το στοιχείο HTML με id="' + id + '"'); }
    return node;
  }

  function esc(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return map[c]; });
  }

  // Επιτρέπονται μόνο σύνδεσμοι http/https (αποφυγή javascript:).
  function safeUrl(u) {
    if (!u) { return ''; }
    return /^https?:\/\//i.test(u) ? u : '';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function fmt(iso) {
    return new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function toLocalInput(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function hours(l) {
    return (new Date(l.ends_at) - new Date(l.starts_at)) / 3600000;
  }

  var ROLE_LABEL = {
    pending: 'Σε αναμονή',
    admin: 'Διαχειριστής',
    main_teacher: 'Βασικός εκπαιδευτικός',
    assistant_teacher: 'Βοηθητικός εκπαιδευτικός',
    student: 'Μαθητής',
    parent: 'Γονέας'
  };
  var STATUS_LABEL = {
    planned: 'Προγραμματισμένο',
    done: 'Πραγματοποιήθηκε',
    cancelled: 'Ακυρώθηκε',
    absent: 'Απουσία'
  };
  var RELATION_LABEL = {
    student: 'Μαθητής',
    parent: 'Γονέας',
    assistant_teacher: 'Βοηθητικός εκπαιδευτικός'
  };

  // ---------- Σύνδεση με Supabase ----------

  var cfg = window.APP_CONFIG;
  var view = el('view');

  if (!cfg || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('ΤΟ-PROJECT') !== -1) {
    view.innerHTML = '<div class="card narrow"><h2>Λείπει η ρύθμιση</h2>' +
      '<p>Άνοιξε το <code>js/config.js</code> και βάλε το URL και το anon key του Supabase.</p></div>';
    return;
  }
  if (!window.supabase) {
    view.innerHTML = '<div class="card narrow"><h2>Σφάλμα</h2><p>Δεν φορτώθηκε η βιβλιοθήκη Supabase. Έλεγξε τη σύνδεσή σου.</p></div>';
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var state = { session: null, profile: null, authMode: 'login' };

  async function must(promise) {
    var r = await promise;
    if (r.error) { throw new Error(r.error.message); }
    return r.data;
  }

  function canWrite() {
    return state.profile && (state.profile.role === 'admin' || state.profile.role === 'main_teacher');
  }

  // ---------- Είσοδος ----------

  function renderAuth() {
    el('topbar').hidden = true;
    var reg = state.authMode === 'register';
    view.innerHTML =
      '<div class="card narrow">' +
      '<h1>' + (reg ? 'Εγγραφή' : 'Είσοδος') + '</h1>' +
      '<form data-form="auth">' +
      (reg ? '<label for="a-name">Ονοματεπώνυμο</label><input id="a-name" name="name" required>' : '') +
      '<label for="a-email">Email</label><input id="a-email" name="email" type="email" required>' +
      '<label for="a-pass">Κωδικός</label><input id="a-pass" name="password" type="password" minlength="8" required>' +
      '<p><button class="primary" type="submit">' + (reg ? 'Εγγραφή' : 'Είσοδος') + '</button></p>' +
      '</form>' +
      '<p class="muted">' + (reg
        ? 'Έχεις λογαριασμό; <a href="#" data-action="toggle-auth">Είσοδος</a>'
        : 'Νέος χρήστης; <a href="#" data-action="toggle-auth">Εγγραφή</a>') + '</p>' +
      (reg ? '<p class="muted">Γράψε το ίδιο email που έδωσες στον εκπαιδευτικό σου, ώστε να συνδεθείς αυτόματα.</p>' : '') +
      '</div>';
  }

  // ---------- Σελίδες ----------

  function renderNav(active) {
    var role = state.profile.role;
    var items = [['#/', 'Αρχική', 'home']];
    if (role === 'admin' || role === 'main_teacher') { items.push(['#/students', 'Μαθητές', 'students']); }
    if (role !== 'pending') {
      items.push(['#/calendar', 'Ημερολόγιο', 'calendar']);
      items.push(['#/personal', 'Προσωπικό', 'personal']);
    }
    if (role === 'admin') { items.push(['#/users', 'Χρήστες', 'users']); }
    el('nav').innerHTML = items.map(function (i) {
      return '<a href="' + i[0] + '"' + (i[2] === active ? ' class="active"' : '') + '>' + esc(i[1]) + '</a>';
    }).join('');
    el('whoami').textContent = state.profile.full_name + ' · ' + ROLE_LABEL[role];
    el('topbar').hidden = false;
  }

  async function pageHome() {
    renderNav('home');
    var role = state.profile.role;
    if (role === 'pending') {
      view.innerHTML = '<div class="card"><h2>Ο λογαριασμός σου περιμένει έγκριση</h2>' +
        '<p>Ο διαχειριστής ή ο εκπαιδευτικός σου πρέπει να σου δώσει ρόλο. Δοκίμασε ξανά αργότερα.</p></div>';
      return;
    }
    var nowIso = new Date().toISOString();
    var lessons = await must(sb.from('lessons')
      .select('id, starts_at, ends_at, meeting_url, status, students(full_name)')
      .eq('status', 'planned').gte('ends_at', nowIso)
      .order('starts_at').limit(5));
    var events = await must(sb.from('personal_events')
      .select('id, title, due_at').eq('done', false).order('due_at').limit(5));

    var tiles = '';
    if (role === 'admin' || role === 'main_teacher') {
      tiles += '<a class="tile" href="#/students"><strong>Μαθητές</strong><span>Μαθητές, γονείς και βοηθοί</span></a>';
    }
    tiles += '<a class="tile" href="#/calendar"><strong>Ημερολόγιο / Παρουσιολόγιο</strong><span>Προγραμματισμένες και πραγματοποιημένες ώρες</span></a>';
    tiles += '<a class="tile" href="#/personal"><strong>Προσωπικό ημερολόγιο</strong><span>Οι επόμενες υποχρεώσεις σου</span></a>';
    if (role === 'admin') {
      tiles += '<a class="tile" href="#/users"><strong>Χρήστες</strong><span>Ρόλοι και εποπτεία</span></a>';
    }

    var next = lessons.length ? lessons[0] : null;
    var nextHtml;
    if (!next) {
      nextHtml = '<p class="empty">Δεν υπάρχει προγραμματισμένο μάθημα.</p>';
    } else {
      var url = safeUrl(next.meeting_url);
      nextHtml = '<p><strong>' + esc(fmt(next.starts_at)) + '</strong> · ' +
        esc(next.students ? next.students.full_name : '') + '</p>' +
        (url
          ? '<p><a class="tile" style="display:inline-block" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><strong>Είσοδος στο μάθημα</strong></a></p>'
          : '<p class="muted">Δεν έχει οριστεί σύνδεσμος βιντεοκλήσης.</p>');
    }

    view.innerHTML =
      '<h1>Καλώς ήρθες, ' + esc(state.profile.full_name) + '</h1>' +
      '<div class="grid" style="margin-bottom:16px">' + tiles + '</div>' +
      '<div class="card"><h2>Επόμενο μάθημα</h2>' + nextHtml + '</div>' +
      '<div class="card"><h2>Επόμενες υποχρεώσεις</h2>' +
      (events.length
        ? '<table><tbody>' + events.map(function (e) {
          return '<tr><td>' + esc(fmt(e.due_at)) + '</td><td>' + esc(e.title) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Καμία υποχρέωση.</p>') +
      '</div>';
  }

  async function pageStudents() {
    renderNav('students');
    if (!canWrite()) { location.hash = '#/'; return; }
    var students = await must(sb.from('students').select('id, full_name, grade').order('full_name'));
    view.innerHTML =
      '<h1>Μαθητές</h1>' +
      '<div class="card"><h2>Νέος μαθητής</h2>' +
      '<form data-form="add-student" class="row">' +
      '<div><label for="s-name">Ονοματεπώνυμο</label><input id="s-name" name="name" required></div>' +
      '<div><label for="s-grade">Τάξη</label><input id="s-grade" name="grade"></div>' +
      '<button class="primary" type="submit">Προσθήκη</button>' +
      '</form></div>' +
      '<div class="card">' +
      (students.length
        ? '<table><thead><tr><th>Όνομα</th><th>Τάξη</th><th></th></tr></thead><tbody>' +
        students.map(function (s) {
          return '<tr><td>' + esc(s.full_name) + '</td><td>' + esc(s.grade) + '</td>' +
            '<td><a href="#/student/' + esc(s.id) + '">Άνοιγμα</a></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Δεν έχεις ακόμη μαθητές.</p>') +
      '</div>';
  }

  async function pageStudent(id) {
    renderNav('students');
    if (!canWrite()) { location.hash = '#/'; return; }
    var rows = await must(sb.from('students').select('id, full_name, grade, notes, user_id').eq('id', id).limit(1));
    if (!rows.length) { view.innerHTML = '<div class="card"><p>Δεν βρέθηκε ο μαθητής.</p></div>'; return; }
    var s = rows[0];
    var invites = await must(sb.from('invites').select('id, email, relation').eq('student_id', id).order('created_at'));
    var parents = await must(sb.from('student_parents').select('parent_id, profiles(full_name, email)').eq('student_id', id));
    var assistants = await must(sb.from('student_assistants').select('assistant_id, profiles(full_name, email)').eq('student_id', id));

    function person(p) { return p && p.profiles ? esc(p.profiles.full_name) + ' <span class="muted">(' + esc(p.profiles.email) + ')</span>' : ''; }

    view.innerHTML =
      '<p><a href="#/students">← Μαθητές</a></p>' +
      '<h1>' + esc(s.full_name) + '</h1>' +
      '<div class="card"><h2>Στοιχεία</h2>' +
      '<form data-form="edit-student" data-id="' + esc(s.id) + '">' +
      '<label for="e-name">Ονοματεπώνυμο</label><input id="e-name" name="name" value="' + esc(s.full_name) + '" required>' +
      '<label for="e-grade">Τάξη</label><input id="e-grade" name="grade" value="' + esc(s.grade) + '">' +
      '<label for="e-notes">Σημειώσεις (ορατές μόνο σε σένα και στους διαχειριστές)</label>' +
      '<textarea id="e-notes" name="notes" rows="3">' + esc(s.notes) + '</textarea>' +
      '<p><button class="primary" type="submit">Αποθήκευση</button> ' +
      '<button type="button" class="danger" data-action="delete-student" data-id="' + esc(s.id) + '">Διαγραφή μαθητή</button></p>' +
      '</form></div>' +
      '<div class="card"><h2>Πρόσβαση (μαθητής, γονείς, βοηθοί)</h2>' +
      '<p class="muted">Γράψε το email και επέλεξε ρόλο. Ο άνθρωπος πρέπει να εγγραφεί ΜΕΤΑ την πρόσκληση, με το ίδιο email. Τότε συνδέεται αυτόματα.</p>' +
      '<form data-form="add-invite" data-id="' + esc(s.id) + '" class="row">' +
      '<div><label for="i-email">Email</label><input id="i-email" name="email" type="email" required></div>' +
      '<div><label for="i-rel">Ρόλος</label><select id="i-rel" name="relation">' +
      Object.keys(RELATION_LABEL).map(function (k) { return '<option value="' + k + '">' + esc(RELATION_LABEL[k]) + '</option>'; }).join('') +
      '</select></div><button class="primary" type="submit">Πρόσκληση</button></form>' +
      '<h2 style="margin-top:16px">Εκκρεμείς προσκλήσεις</h2>' +
      (invites.length
        ? '<table><tbody>' + invites.map(function (i) {
          return '<tr><td>' + esc(i.email) + '</td><td>' + esc(RELATION_LABEL[i.relation]) + '</td>' +
            '<td><button class="danger" data-action="delete-invite" data-id="' + esc(i.id) + '" data-student="' + esc(s.id) + '">Αφαίρεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Καμία.</p>') +
      '<h2 style="margin-top:16px">Γονείς</h2>' +
      (parents.length
        ? '<table><tbody>' + parents.map(function (p) {
          return '<tr><td>' + person(p) + '</td><td><button class="danger" data-action="unlink-parent" data-id="' + esc(p.parent_id) + '" data-student="' + esc(s.id) + '">Αποσύνδεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Κανένας συνδεδεμένος γονέας.</p>') +
      '<h2 style="margin-top:16px">Βοηθητικοί εκπαιδευτικοί</h2>' +
      (assistants.length
        ? '<table><tbody>' + assistants.map(function (a) {
          return '<tr><td>' + person(a) + '</td><td><button class="danger" data-action="unlink-assistant" data-id="' + esc(a.assistant_id) + '" data-student="' + esc(s.id) + '">Αποσύνδεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Κανένας συνδεδεμένος βοηθός.</p>') +
      '<p class="muted">Λογαριασμός μαθητή: ' + (s.user_id ? 'συνδεδεμένος' : 'δεν έχει συνδεθεί ακόμη') + '</p>' +
      '</div>';
  }

  var calFilter = { student: '', period: 'upcoming' };

  async function pageCalendar() {
    renderNav('calendar');
    var students = await must(sb.from('students').select('id, full_name, teacher_id').order('full_name'));
    var q = sb.from('lessons')
      .select('id, student_id, starts_at, ends_at, status, meeting_url, notes, students(full_name)')
      .order('starts_at', { ascending: calFilter.period !== 'past' });
    var nowIso = new Date().toISOString();
    if (calFilter.period === 'upcoming') { q = q.gte('ends_at', nowIso); }
    if (calFilter.period === 'past') { q = q.lt('ends_at', nowIso); }
    if (calFilter.student) { q = q.eq('student_id', calFilter.student); }
    var lessons = await must(q.limit(300));

    // Σύνοψη παρουσιολογίου ανά μαθητή, πάνω στα εμφανιζόμενα μαθήματα.
    var sum = {};
    lessons.forEach(function (l) {
      var name = l.students ? l.students.full_name : '—';
      if (!sum[name]) { sum[name] = { planned: 0, done: 0, absent: 0, cancelled: 0 }; }
      sum[name][l.status] += hours(l);
    });

    var write = canWrite();
    var start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);

    var studentOptions = students.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === calFilter.student ? ' selected' : '') + '>' + esc(s.full_name) + '</option>';
    }).join('');

    view.innerHTML =
      '<h1>Ημερολόγιο / Παρουσιολόγιο</h1>' +
      (write
        ? '<div class="card"><h2>Νέο μάθημα</h2><form data-form="add-lesson" class="row">' +
        '<div><label for="l-student">Μαθητής</label><select id="l-student" name="student" required>' +
        '<option value="">—</option>' +
        students.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.full_name) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label for="l-start">Έναρξη</label><input id="l-start" name="start" type="datetime-local" value="' + toLocalInput(start) + '" required></div>' +
        '<div><label for="l-dur">Διάρκεια (λεπτά)</label><input id="l-dur" name="duration" type="number" min="15" step="15" value="60" required></div>' +
        '<div><label for="l-url">Σύνδεσμος βιντεοκλήσης</label><input id="l-url" name="url" type="url" placeholder="https://meet.google.com/..."></div>' +
        '<button class="primary" type="submit">Προσθήκη</button></form></div>'
        : '') +
      '<div class="card"><div class="row">' +
      '<div><label for="f-student">Μαθητής</label><select id="f-student" data-change="cal-filter-student"><option value="">Όλοι</option>' + studentOptions + '</select></div>' +
      '<div><label for="f-period">Περίοδος</label><select id="f-period" data-change="cal-filter-period">' +
      [['upcoming', 'Επόμενα'], ['past', 'Παλαιότερα'], ['all', 'Όλα']].map(function (p) {
        return '<option value="' + p[0] + '"' + (p[0] === calFilter.period ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div></div></div>' +
      '<div class="card"><h2>Σύνοψη ωρών</h2>' +
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
        ? '<table><thead><tr><th>Πότε</th><th>Μαθητής</th><th>Κατάσταση</th><th>Βιντεοκλήση</th>' + (write ? '<th></th>' : '') + '</tr></thead><tbody>' +
        lessons.map(function (l) {
          var url = safeUrl(l.meeting_url);
          return '<tr><td>' + esc(fmt(l.starts_at)) + ' <span class="muted">(' + hours(l).toFixed(1) + ' ω)</span></td>' +
            '<td>' + esc(l.students ? l.students.full_name : '') + '</td>' +
            '<td>' + (write
              ? '<select data-change="lesson-status" data-id="' + esc(l.id) + '">' +
              Object.keys(STATUS_LABEL).map(function (k) {
                return '<option value="' + k + '"' + (k === l.status ? ' selected' : '') + '>' + esc(STATUS_LABEL[k]) + '</option>';
              }).join('') + '</select>'
              : '<span class="badge ' + esc(l.status) + '">' + esc(STATUS_LABEL[l.status]) + '</span>') + '</td>' +
            '<td>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Σύνδεσμος</a>' : '<span class="muted">—</span>') + '</td>' +
            (write ? '<td><button class="danger" data-action="delete-lesson" data-id="' + esc(l.id) + '">Διαγραφή</button></td>' : '') +
            '</tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Δεν υπάρχουν μαθήματα.</p>') +
      '</div>';
  }

  async function pagePersonal() {
    renderNav('personal');
    var events = await must(sb.from('personal_events').select('id, title, due_at, done').order('due_at'));
    var due = new Date(); due.setMinutes(0, 0, 0); due.setHours(due.getHours() + 1);
    view.innerHTML =
      '<h1>Προσωπικό ημερολόγιο</h1>' +
      '<div class="card"><form data-form="add-event" class="row">' +
      '<div><label for="p-title">Υποχρέωση</label><input id="p-title" name="title" required></div>' +
      '<div><label for="p-due">Πότε</label><input id="p-due" name="due" type="datetime-local" value="' + toLocalInput(due) + '" required></div>' +
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
  }

  async function pageUsers() {
    renderNav('users');
    if (state.profile.role !== 'admin') { location.hash = '#/'; return; }
    var users = await must(sb.from('profiles').select('id, email, full_name, role, created_at').order('created_at', { ascending: false }));
    view.innerHTML =
      '<h1>Χρήστες</h1><div class="card">' +
      '<p class="muted">Νέοι χρήστες χωρίς πρόσκληση μένουν «Σε αναμονή» μέχρι να τους δώσεις ρόλο.</p>' +
      '<table><thead><tr><th>Όνομα</th><th>Email</th><th>Ρόλος</th></tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr><td>' + esc(u.full_name) + '</td><td>' + esc(u.email) + '</td><td>' +
          '<select data-change="user-role" data-id="' + esc(u.id) + '"' + (u.id === state.profile.id ? ' disabled' : '') + '>' +
          Object.keys(ROLE_LABEL).map(function (k) {
            return '<option value="' + k + '"' + (k === u.role ? ' selected' : '') + '>' + esc(ROLE_LABEL[k]) + '</option>';
          }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- Δρομολόγηση ----------

  async function route() {
    if (!state.session) { renderAuth(); return; }
    try {
      if (!state.profile) {
        var rows = await must(sb.from('profiles').select('id, email, full_name, role').eq('id', state.session.user.id).limit(1));
        if (!rows.length) {
          throw new Error('Δεν βρέθηκε το προφίλ σου. Έτρεξε το supabase/schema.sql πριν την εγγραφή;');
        }
        state.profile = rows[0];
      }
      var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
      switch (parts[0]) {
        case '': await pageHome(); break;
        case 'students': await pageStudents(); break;
        case 'student': await pageStudent(parts[1]); break;
        case 'calendar': await pageCalendar(); break;
        case 'personal': await pagePersonal(); break;
        case 'users': await pageUsers(); break;
        default: location.hash = '#/';
      }
    } catch (e) {
      console.error(e);
      view.innerHTML = '<div class="card"><h2>Σφάλμα</h2><p>' + esc(e.message) + '</p></div>';
    }
  }

  // ---------- Ενέργειες ----------

  async function run(fn) {
    try { await fn(); } catch (e) { console.error(e); toast('Σφάλμα: ' + e.message); }
  }

  var actions = {
    'toggle-auth': function () {
      state.authMode = state.authMode === 'login' ? 'register' : 'login';
      renderAuth();
    },
    'delete-student': async function (t) {
      if (!confirm('Διαγραφή μαθητή και όλων των μαθημάτων του;')) { return; }
      await must(sb.from('students').delete().eq('id', t.getAttribute('data-id')));
      location.hash = '#/students';
    },
    'delete-invite': async function (t) {
      await must(sb.from('invites').delete().eq('id', t.getAttribute('data-id')));
      await pageStudent(t.getAttribute('data-student'));
    },
    'unlink-parent': async function (t) {
      var sid = t.getAttribute('data-student');
      await must(sb.from('student_parents').delete().eq('student_id', sid).eq('parent_id', t.getAttribute('data-id')));
      await pageStudent(sid);
    },
    'unlink-assistant': async function (t) {
      var sid = t.getAttribute('data-student');
      await must(sb.from('student_assistants').delete().eq('student_id', sid).eq('assistant_id', t.getAttribute('data-id')));
      await pageStudent(sid);
    },
    'delete-lesson': async function (t) {
      if (!confirm('Διαγραφή μαθήματος;')) { return; }
      await must(sb.from('lessons').delete().eq('id', t.getAttribute('data-id')));
      await pageCalendar();
    },
    'delete-event': async function (t) {
      await must(sb.from('personal_events').delete().eq('id', t.getAttribute('data-id')));
      await pagePersonal();
    }
  };

  var forms = {
    'auth': async function (f) {
      var email = f.elements['email'].value.trim();
      var password = f.elements['password'].value;
      if (state.authMode === 'register') {
        var name = f.elements['name'].value.trim();
        var r = await sb.auth.signUp({ email: email, password: password, options: { data: { full_name: name } } });
        if (r.error) { throw new Error(r.error.message); }
        if (!r.data.session) {
          toast('Έλεγξε το email σου για επιβεβαίωση και μετά κάνε είσοδο.');
          state.authMode = 'login';
          renderAuth();
        }
      } else {
        var l = await sb.auth.signInWithPassword({ email: email, password: password });
        if (l.error) { throw new Error(l.error.message); }
      }
    },
    'add-student': async function (f) {
      await must(sb.from('students').insert({
        teacher_id: state.profile.id,
        full_name: f.elements['name'].value.trim(),
        grade: f.elements['grade'].value.trim() || null
      }));
      await pageStudents();
    },
    'edit-student': async function (f) {
      await must(sb.from('students').update({
        full_name: f.elements['name'].value.trim(),
        grade: f.elements['grade'].value.trim() || null,
        notes: f.elements['notes'].value.trim() || null
      }).eq('id', f.getAttribute('data-id')));
      toast('Αποθηκεύτηκε.');
      await pageStudent(f.getAttribute('data-id'));
    },
    'add-invite': async function (f) {
      var sid = f.getAttribute('data-id');
      await must(sb.from('invites').insert({
        student_id: sid,
        email: f.elements['email'].value.trim().toLowerCase(),
        relation: f.elements['relation'].value
      }));
      await pageStudent(sid);
    },
    'add-lesson': async function (f) {
      var sid = f.elements['student'].value;
      if (!sid) { throw new Error('Διάλεξε μαθητή.'); }
      var st = await must(sb.from('students').select('teacher_id').eq('id', sid).limit(1));
      if (!st.length) { throw new Error('Δεν βρέθηκε ο μαθητής.'); }
      var startD = new Date(f.elements['start'].value);
      var endD = new Date(startD.getTime() + Number(f.elements['duration'].value) * 60000);
      var url = f.elements['url'].value.trim();
      if (url && !safeUrl(url)) { throw new Error('Ο σύνδεσμος πρέπει να αρχίζει με http:// ή https://'); }
      await must(sb.from('lessons').insert({
        teacher_id: st[0].teacher_id,
        student_id: sid,
        starts_at: startD.toISOString(),
        ends_at: endD.toISOString(),
        meeting_url: url || null
      }));
      await pageCalendar();
    },
    'add-event': async function (f) {
      await must(sb.from('personal_events').insert({
        user_id: state.profile.id,
        title: f.elements['title'].value.trim(),
        due_at: new Date(f.elements['due'].value).toISOString()
      }));
      await pagePersonal();
    }
  };

  var changes = {
    'cal-filter-student': async function (t) { calFilter.student = t.value; await pageCalendar(); },
    'cal-filter-period': async function (t) { calFilter.period = t.value; await pageCalendar(); },
    'lesson-status': async function (t) {
      await must(sb.from('lessons').update({ status: t.value }).eq('id', t.getAttribute('data-id')));
      await pageCalendar();
    },
    'toggle-event': async function (t) {
      await must(sb.from('personal_events').update({ done: t.checked }).eq('id', t.getAttribute('data-id')));
      await pagePersonal();
    },
    'user-role': async function (t) {
      await must(sb.from('profiles').update({ role: t.value }).eq('id', t.getAttribute('data-id')));
      toast('Ο ρόλος άλλαξε.');
    }
  };

  view.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (!t) { return; }
    ev.preventDefault();
    var name = t.getAttribute('data-action');
    if (!actions[name]) { console.error('Άγνωστη ενέργεια: ' + name); return; }
    run(function () { return actions[name](t); });
  });

  view.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) { return; }
    ev.preventDefault();
    var name = f.getAttribute('data-form');
    if (!forms[name]) { console.error('Άγνωστη φόρμα: ' + name); return; }
    run(function () { return forms[name](f); });
  });

  view.addEventListener('change', function (ev) {
    var t = ev.target.closest('[data-change]');
    if (!t) { return; }
    var name = t.getAttribute('data-change');
    if (!changes[name]) { console.error('Άγνωστη αλλαγή: ' + name); return; }
    run(function () { return changes[name](t); });
  });

  el('btn-logout').addEventListener('click', function () {
    run(async function () {
      await sb.auth.signOut();
    });
  });

  window.addEventListener('hashchange', function () { run(route); });

  sb.auth.onAuthStateChange(function (event, session) {
    state.session = session;
    if (!session) { state.profile = null; }
    // setTimeout: η Supabase προειδοποιεί να μην τρέχουν κλήσεις βάσης μέσα στο callback (κίνδυνος κλειδώματος).
    setTimeout(function () { run(route); }, 0);
  });
})();
