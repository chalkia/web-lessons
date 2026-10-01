// Άνθρωποι: μαθητές, κατάλογος εκπαιδευτικών και συνεργασίες, αιτήματα γονέων.
(function () {
  'use strict';
  if (!window.App || !App.ready) { return; }

  var sb = App.sb, must = App.must, esc = App.esc, view = App.view, fmt = App.fmt;

  // Απόρριψη πρόσβασης με σωστή κατεύθυνση: ο εκπαιδευτικός σε αναμονή πάει στα πιστοποιητικά.
  function denyTeaching() {
    location.hash = App.isTeacher() ? '#/credentials' : '#/';
  }

  // ---------- Μαθητές ----------

  App.pages.students = async function () {
    App.renderNav('students');
    if (!App.canTeach() && !App.isTeacher()) { denyTeaching(); return; }
    var write = App.canTeach();
    var all = await must(sb.from('students').select('id, full_name, grade, teacher_id').order('full_name'));
    // Οι δικοί μου μαθητές (ο διαχειριστής τους βλέπει όλους) και, χωριστά, όσοι βοηθάω.
    var mine = all.filter(function (s) { return App.ownsTeacher(s.teacher_id); });
    var assisted = all.filter(function (s) { return !App.ownsTeacher(s.teacher_id); });
    var assistedHtml = assisted.length
      ? '<div class="card"><h2>Μαθητές όπου είμαι βοηθός</h2>' +
        '<p class="muted">Τους βλέπεις και βλέπεις τα μαθήματά τους στο ημερολόγιο. Δεν τους επεξεργάζεσαι.</p>' +
        '<table><tbody>' + assisted.map(function (s) {
          return '<tr><td>' + esc(s.full_name) + '</td><td>' + esc(s.grade) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '';
    if (!write) {
      view.innerHTML = '<h1>Μαθητές</h1>' +
        '<div class="card"><p>Είσαι βοηθητικός εκπαιδευτικός: δεν έχεις δικούς σου μαθητές μέχρι να εγκριθείς. Για έγκριση πήγαινε στα <a href="#/credentials">Πιστοποιητικά</a>.</p></div>' +
        (assisted.length ? assistedHtml : '<div class="card"><p class="empty">Δεν βοηθάς ακόμη κάποιον μαθητή. Συνεργάσου με έναν εκπαιδευτικό από τη σελίδα Συνεργάτες και όρισέ σε βοηθό.</p></div>');
      return;
    }
    view.innerHTML =
      '<h1>Μαθητές</h1>' +
      '<div class="card"><h2>Νέος μαθητής</h2>' +
      '<form data-form="add-student" class="row">' +
      '<div><label for="s-name">Ονοματεπώνυμο</label><input id="s-name" name="name" required></div>' +
      '<div><label for="s-grade">Τάξη</label><input id="s-grade" name="grade"></div>' +
      '<button class="primary" type="submit">Προσθήκη</button>' +
      '</form></div>' +
      '<div class="card">' +
      (mine.length
        ? '<table><thead><tr><th>Όνομα</th><th>Τάξη</th><th></th></tr></thead><tbody>' +
        mine.map(function (s) {
          return '<tr><td>' + esc(s.full_name) + '</td><td>' + esc(s.grade) + '</td>' +
            '<td><a href="#/student/' + esc(s.id) + '">Άνοιγμα</a></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Δεν έχεις ακόμη μαθητές. Πρόσθεσε έναν ή περίμενε αιτήματα γονέων στη σελίδα Αιτήματα.</p>') +
      '</div>' + assistedHtml;
  };

  App.forms['add-student'] = async function (f) {
    await must(sb.from('students').insert({
      teacher_id: App.state.profile.id,
      full_name: f.elements['name'].value.trim(),
      grade: f.elements['grade'].value.trim() || null
    }));
    await App.pages.students();
  };

  App.pages.student = async function (id) {
    App.renderNav('students');
    if (!App.canTeach()) { denyTeaching(); return; }
    var rows = await must(sb.from('students').select('id, teacher_id, full_name, grade, user_id').eq('id', id).limit(1));
    if (!rows.length) { view.innerHTML = '<div class="card"><p>Δεν βρέθηκε ο μαθητής.</p></div>'; return; }
    var s = rows[0];
    if (!App.ownsTeacher(s.teacher_id)) {
      view.innerHTML = '<div class="card"><p>Είσαι βοηθός σε αυτόν τον μαθητή. Τον επεξεργάζεται μόνο ο εκπαιδευτικός του.</p></div>';
      return;
    }
    var noteRows = await must(sb.from('student_notes').select('notes').eq('student_id', id).limit(1));
    var noteText = noteRows.length ? noteRows[0].notes : '';
    var invites = await must(sb.from('invites').select('id, email, relation').eq('student_id', id).order('created_at'));
    var parents = await must(sb.from('student_parents').select('parent_id, profiles(full_name, email)').eq('student_id', id));
    var assistants = await must(sb.from('student_assistants').select('assistant_id, profiles(full_name, email)').eq('student_id', id));
    var dir = await must(sb.rpc('teacher_directory'));
    var assigned = assistants.map(function (a) { return a.assistant_id; });
    var collabs = dir.filter(function (d) { return d.collab_status === 'accepted' && assigned.indexOf(d.id) === -1; });

    function person(p) {
      return p && p.profiles ? esc(p.profiles.full_name) + ' <span class="muted">(' + esc(p.profiles.email) + ')</span>' : '';
    }

    view.innerHTML =
      '<p><a href="#/students">← Μαθητές</a></p>' +
      '<h1>' + esc(s.full_name) + '</h1>' +
      '<div class="card"><h2>Στοιχεία</h2>' +
      '<form data-form="edit-student" data-id="' + esc(s.id) + '">' +
      '<label for="e-name">Ονοματεπώνυμο</label><input id="e-name" name="name" value="' + esc(s.full_name) + '" required>' +
      '<label for="e-grade">Τάξη</label><input id="e-grade" name="grade" value="' + esc(s.grade) + '">' +
      '<label for="e-notes">Σημειώσεις (ορατές μόνο σε σένα και στους διαχειριστές)</label>' +
      '<textarea id="e-notes" name="notes" rows="3">' + esc(noteText) + '</textarea>' +
      '<p><button class="primary" type="submit">Αποθήκευση</button> ' +
      '<button type="button" class="danger" data-action="delete-student" data-id="' + esc(s.id) + '">Διαγραφή μαθητή</button></p>' +
      '</form></div>' +

      '<div class="card"><h2>Μαθητής και γονείς</h2>' +
      '<p class="muted">Γράψε το email και επέλεξε σχέση. Αν ο άνθρωπος έχει ήδη λογαριασμό, συνδέεται αμέσως. Αλλιώς συνδέεται μόλις εγγραφεί με το ίδιο email.</p>' +
      '<form data-form="add-invite" data-id="' + esc(s.id) + '" class="row">' +
      '<div><label for="i-email">Email</label><input id="i-email" name="email" type="email" required></div>' +
      '<div><label for="i-rel">Σχέση</label><select id="i-rel" name="relation">' +
      Object.keys(App.RELATION_LABEL).map(function (k) { return '<option value="' + k + '">' + esc(App.RELATION_LABEL[k]) + '</option>'; }).join('') +
      '</select></div><button class="primary" type="submit">Σύνδεση</button></form>' +
      '<h2 style="margin-top:16px">Σε αναμονή εγγραφής</h2>' +
      (invites.length
        ? '<table><tbody>' + invites.map(function (i) {
          return '<tr><td>' + esc(i.email) + '</td><td>' + esc(App.RELATION_LABEL[i.relation]) + '</td>' +
            '<td><button class="danger" data-action="delete-invite" data-id="' + esc(i.id) + '" data-student="' + esc(s.id) + '">Αφαίρεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Καμία.</p>') +
      '<h2 style="margin-top:16px">Γονείς</h2>' +
      (parents.length
        ? '<table><tbody>' + parents.map(function (p) {
          return '<tr><td>' + person(p) + '</td><td><button class="danger" data-action="unlink-parent" data-id="' + esc(p.parent_id) + '" data-student="' + esc(s.id) + '">Αποσύνδεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Κανένας συνδεδεμένος γονέας.</p>') +
      '<p class="muted">Λογαριασμός μαθητή: ' + (s.user_id ? 'συνδεδεμένος' : 'δεν έχει συνδεθεί ακόμη') + '</p>' +
      '</div>' +

      '<div class="card"><h2>Βοηθοί</h2>' +
      '<p class="muted">Βοηθός γίνεται μόνο συνεργάτης σου, δηλαδή εκπαιδευτικός που αποδέχτηκε πρόσκληση συνεργασίας.</p>' +
      (assistants.length
        ? '<table><tbody>' + assistants.map(function (a) {
          return '<tr><td>' + person(a) + '</td><td><button class="danger" data-action="unlink-assistant" data-id="' + esc(a.assistant_id) + '" data-student="' + esc(s.id) + '">Αποσύνδεση</button></td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Κανένας βοηθός.</p>') +
      (collabs.length
        ? '<form data-form="add-assistant" data-id="' + esc(s.id) + '" class="row">' +
        '<div><label for="as-pick">Συνεργάτης</label><select id="as-pick" name="assistant">' +
        collabs.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.full_name) + '</option>'; }).join('') +
        '</select></div><button class="primary" type="submit">Ανάθεση ως βοηθού</button></form>'
        : '<p class="muted">Δεν υπάρχει διαθέσιμος συνεργάτης. Προσκάλεσε εκπαιδευτικούς από τη σελίδα <a href="#/teachers">Συνεργάτες</a>.</p>') +
      '</div>';
  };

  App.forms['edit-student'] = async function (f) {
    var sid = f.getAttribute('data-id');
    await must(sb.from('students').update({
      full_name: f.elements['name'].value.trim(),
      grade: f.elements['grade'].value.trim() || null
    }).eq('id', sid));
    // Οι σημειώσεις είναι σε χωριστό πίνακα, ορατές μόνο στον εκπαιδευτικό και στον διαχειριστή.
    await must(sb.from('student_notes').upsert({
      student_id: sid,
      notes: f.elements['notes'].value.trim() || null
    }));
    App.toast('Αποθηκεύτηκε.');
    await App.pages.student(sid);
  };

  App.forms['add-invite'] = async function (f) {
    var sid = f.getAttribute('data-id');
    // Η συνάρτηση της βάσης συνδέει αμέσως αν υπάρχει λογαριασμός, αλλιώς καταχωρεί πρόσκληση.
    await must(sb.rpc('add_access', {
      sid: sid,
      target_email: f.elements['email'].value.trim().toLowerCase(),
      rel: f.elements['relation'].value
    }));
    App.toast('Καταχωρήθηκε.');
    await App.pages.student(sid);
  };

  App.forms['add-assistant'] = async function (f) {
    var sid = f.getAttribute('data-id');
    await must(sb.rpc('add_assistant', { sid: sid, p_assistant: f.elements['assistant'].value }));
    App.toast('Ο βοηθός ανατέθηκε.');
    await App.pages.student(sid);
  };

  App.actions['delete-student'] = async function (t) {
    if (!confirm('Διαγραφή μαθητή και όλων των μαθημάτων του;')) { return; }
    var rows = await must(sb.from('students').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η διαγραφή δεν εφαρμόστηκε.'); }
    location.hash = '#/students';
  };

  // Οι αποσυνδέσεις και η αφαίρεση πρόσκλησης: ελέγχουμε ότι πράγματι σβήστηκε γραμμή
  // (το RLS σβήνει σιωπηλά 0 γραμμές αντί να βγάζει σφάλμα).
  App.actions['delete-invite'] = async function (t) {
    var rows = await must(sb.from('invites').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η αφαίρεση δεν εφαρμόστηκε.'); }
    await App.pages.student(t.getAttribute('data-student'));
  };
  App.actions['unlink-parent'] = async function (t) {
    var sid = t.getAttribute('data-student');
    var rows = await must(sb.from('student_parents').delete()
      .eq('student_id', sid).eq('parent_id', t.getAttribute('data-id')).select('student_id'));
    if (!rows.length) { throw new Error('Η αποσύνδεση δεν εφαρμόστηκε.'); }
    await App.pages.student(sid);
  };
  App.actions['unlink-assistant'] = async function (t) {
    var sid = t.getAttribute('data-student');
    var rows = await must(sb.from('student_assistants').delete()
      .eq('student_id', sid).eq('assistant_id', t.getAttribute('data-id')).select('student_id'));
    if (!rows.length) { throw new Error('Η αποσύνδεση δεν εφαρμόστηκε.'); }
    await App.pages.student(sid);
  };

  // ---------- Κατάλογος εκπαιδευτικών / συνεργασίες ----------

  function teacherCard(d, extra) {
    return '<div class="card"><h2>' + esc(d.full_name) +
      (d.approved ? '' : ' <span class="badge draft">Βοηθητικός</span>') + '</h2>' +
      (d.subjects ? '<p><strong>' + esc(d.subjects) + '</strong></p>' : '') +
      (d.bio ? '<p class="muted">' + esc(d.bio) + '</p>' : '') + extra + '</div>';
  }

  App.pages.teachers = async function () {
    var role = App.state.profile.role;
    App.renderNav('teachers');
    if (role === 'admin') { location.hash = '#/'; return; }
    if (role === 'student' && !App.canRequest()) {
      view.innerHTML = '<h1>Εκπαιδευτικοί</h1><div class="card"><p>Το αίτημα συνεργασίας σε εκπαιδευτικό το στέλνει ο γονέας ή ο ενήλικος μαθητής. Ζήτησε από τον γονέα σου να κάνει είσοδο.</p></div>';
      return;
    }
    var dir = await must(sb.rpc('teacher_directory'));

    if (role === 'teacher') {
      var incoming = dir.filter(function (d) { return d.collab_status === 'pending' && d.collab_direction === 'in'; });
      var accepted = dir.filter(function (d) { return d.collab_status === 'accepted'; });
      var outgoing = dir.filter(function (d) { return d.collab_status === 'pending' && d.collab_direction === 'out'; });
      var others = dir.filter(function (d) { return !d.collab_status; });
      view.innerHTML =
        '<h1>Συνεργάτες</h1>' +
        '<div class="card"><h2>Διαθεσιμότητα</h2>' +
        '<p class="muted">Αν δεν ενδιαφέρεσαι για νέες συνεργασίες, κλείσε τους διακόπτες. Όσα ισχύουν ήδη δεν αλλάζουν.</p>' +
        (App.canTeach()
          ? '<label class="check"><input type="checkbox" data-change="avail-requests"' + (App.state.profile.accepting_requests ? ' checked' : '') + '> Δέχομαι νέα αιτήματα από γονείς και μαθητές</label><br>'
          : '') +
        '<label class="check"><input type="checkbox" data-change="avail-collabs"' + (App.state.profile.accepting_collabs ? ' checked' : '') + '> ' +
        (App.canTeach() ? 'Δέχομαι νέες προσκλήσεις συνεργασίας από άλλους εκπαιδευτικούς' : 'Δέχομαι νέες προσκλήσεις συνεργασίας ως βοηθός') + '</label></div>' +
        (App.canTeach()
          ? '<p class="muted">Εδώ βλέπεις τους άλλους εκπαιδευτικούς, και τους βοηθητικούς που δεν έχουν ακόμη έγκριση. Όποιον αποδεχτεί πρόσκληση συνεργασίας μπορείς να τον ορίσεις βοηθό στους μαθητές σου.</p>'
          : '<p class="muted">Είσαι βοηθητικός εκπαιδευτικός. Στείλε πρόσκληση σε εγκεκριμένο εκπαιδευτικό. Αν την αποδεχτεί, μπορεί να σε ορίσει βοηθό στους μαθητές του.</p>') +
        (incoming.length ? '<h2>Προσκλήσεις προς εσένα</h2>' + incoming.map(function (d) {
          return teacherCard(d, '<p><button class="primary" data-action="collab-accept" data-id="' + esc(d.collab_id) + '">Αποδοχή</button> ' +
            '<button class="danger" data-action="collab-decline" data-id="' + esc(d.collab_id) + '">Απόρριψη</button></p>');
        }).join('') : '') +
        '<h2>Οι συνεργάτες μου</h2>' +
        (accepted.length ? accepted.map(function (d) {
          return teacherCard(d, '<p><button class="danger" data-action="collab-remove" data-id="' + esc(d.collab_id) + '">Λήξη συνεργασίας</button></p>');
        }).join('') : '<div class="card"><p class="empty">Κανένας ακόμη.</p></div>') +
        (outgoing.length ? '<h2>Προσκλήσεις που έστειλα</h2>' + outgoing.map(function (d) {
          return teacherCard(d, '<p><span class="badge pending">Σε αναμονή</span> <button class="danger" data-action="collab-remove" data-id="' + esc(d.collab_id) + '">Ακύρωση</button></p>');
        }).join('') : '') +
        '<h2>' + (App.canTeach() ? 'Άλλοι εκπαιδευτικοί' : 'Εγκεκριμένοι εκπαιδευτικοί') + '</h2>' +
        (others.length ? others.map(function (d) {
          return teacherCard(d, d.accepting_collabs
            ? '<p><button class="primary" data-action="collab-request" data-id="' + esc(d.id) + '">Πρόσκληση συνεργασίας</button></p>'
            : '<p><span class="badge draft">Δεν δέχεται νέες συνεργασίες</span></p>');
        }).join('') : '<div class="card"><p class="empty">Δεν υπάρχουν άλλοι εκπαιδευτικοί.</p></div>');
      return;
    }

    // Μαθητής / γονέας: κατάλογος και αιτήματα
    var reqs = await must(sb.from('interest_requests')
      .select('id, teacher_id, child_name, status, created_at').order('created_at', { ascending: false }));
    var nameBy = {};
    dir.forEach(function (d) { nameBy[d.id] = d.full_name; });
    var pendingTo = reqs.filter(function (r) { return r.status === 'pending'; }).map(function (r) { return r.teacher_id; });

    view.innerHTML =
      '<h1>Εκπαιδευτικοί</h1>' +
      '<p class="muted">Διάλεξε εκπαιδευτικό και στείλε αίτημα. Αν το αποδεχτεί, το παιδί προστίθεται στους μαθητές του και μπορείτε να κλείσετε ραντεβού γνωριμίας στο ημερολόγιο.</p>' +
      (reqs.length
        ? '<div class="card"><h2>Τα αιτήματά μου</h2><table><tbody>' + reqs.map(function (r) {
          return '<tr><td>' + esc(nameBy[r.teacher_id] || 'Εκπαιδευτικός') + '</td><td>' + esc(r.child_name) + '</td>' +
            '<td>' + esc(fmt(r.created_at)) + '</td><td><span class="badge ' + esc(r.status) + '">' + esc(App.REQ_STATUS[r.status]) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '') +
      (dir.length ? dir.map(function (d) {
        var form = pendingTo.indexOf(d.id) !== -1
          ? '<p><span class="badge pending">Έχεις στείλει αίτημα</span></p>'
          : !d.accepting_requests
            ? '<p><span class="badge draft">Δεν δέχεται προς το παρόν νέα αιτήματα</span></p>'
            : '<form data-form="send-interest" data-teacher="' + esc(d.id) + '" class="spaced">' +
          '<label class="field">Όνομα παιδιού<input name="child" maxlength="100" required></label>' +
          '<label class="field">Τάξη<input name="grade" maxlength="50"></label>' +
          '<label class="field">Μήνυμα<textarea name="msg" rows="2" maxlength="1000"></textarea></label>' +
          '<button class="primary" type="submit">Αίτημα συνεργασίας</button></form>';
        return teacherCard(d, form);
      }).join('') : '<div class="card"><p class="empty">Δεν υπάρχουν ακόμη εγκεκριμένοι εκπαιδευτικοί.</p></div>');
  };

  // Διαθεσιμότητα του ίδιου του χρήστη. Ελέγχουμε ότι πράγματι άλλαξε γραμμή.
  async function setAvail(column, value) {
    var patch = {};
    patch[column] = value;
    var rows = await must(sb.from('profiles').update(patch).eq('id', App.state.profile.id).select('id'));
    if (!rows.length) { throw new Error('Η αλλαγή δεν εφαρμόστηκε.'); }
    App.state.profile[column] = value;
    App.toast(value ? 'Ξανά διαθέσιμος.' : 'Δεν θα δέχεσαι νέα αιτήματα.');
  }
  App.changes['avail-requests'] = function (t) { return setAvail('accepting_requests', t.checked); };
  App.changes['avail-collabs'] = function (t) { return setAvail('accepting_collabs', t.checked); };

  App.actions['collab-request'] = async function (t) {
    await must(sb.rpc('request_collab', { p_target: t.getAttribute('data-id') }));
    App.toast('Η πρόσκληση στάλθηκε.');
    await App.pages.teachers();
  };
  App.actions['collab-accept'] = async function (t) {
    await must(sb.rpc('respond_collab', { p_id: t.getAttribute('data-id'), p_accept: true }));
    await App.pages.teachers();
  };
  App.actions['collab-decline'] = async function (t) {
    await must(sb.rpc('respond_collab', { p_id: t.getAttribute('data-id'), p_accept: false }));
    await App.pages.teachers();
  };
  App.actions['collab-remove'] = async function (t) {
    if (!confirm('Λήξη της συνεργασίας; Θα αφαιρεθούν και οι αναθέσεις βοηθού μεταξύ σας.')) { return; }
    await must(sb.rpc('remove_collab', { p_id: t.getAttribute('data-id') }));
    await App.pages.teachers();
  };

  App.forms['send-interest'] = async function (f) {
    await must(sb.rpc('send_interest', {
      p_teacher: f.getAttribute('data-teacher'),
      p_child: f.elements['child'].value.trim(),
      p_grade: f.elements['grade'].value.trim(),
      p_msg: f.elements['msg'].value.trim()
    }));
    App.toast('Το αίτημα στάλθηκε.');
    await App.pages.teachers();
  };

  // ---------- Αιτήματα γονέων (εκπαιδευτικός) ----------

  App.pages.requests = async function () {
    App.renderNav('requests');
    if (!App.isTeacher() || !App.canTeach()) { denyTeaching(); return; }
    var reqs = await must(sb.from('interest_requests')
      .select('id, parent_id, child_name, grade, message, status, student_id, created_at')
      .order('created_at', { ascending: false }));
    var pids = reqs.map(function (r) { return r.parent_id; });
    var profs = pids.length ? await must(sb.from('profiles').select('id, full_name, email').in('id', pids)) : [];
    var by = {};
    profs.forEach(function (p) { by[p.id] = p; });
    var pending = reqs.filter(function (r) { return r.status === 'pending'; });
    var done = reqs.filter(function (r) { return r.status !== 'pending'; });
    var accepted = reqs.filter(function (r) { return r.status === 'accepted'; });
    var start = App.toLocalInput(App.nextHour());

    function who(r) {
      var p = by[r.parent_id];
      return p ? esc(p.full_name) + ' <span class="muted">(' + esc(p.email) + ')</span>' : '—';
    }

    view.innerHTML =
      '<h1>Αιτήματα γονέων</h1>' +
      '<h2>Σε αναμονή (' + pending.length + ')</h2>' +
      (pending.length ? pending.map(function (r) {
        return '<div class="card"><h2>' + esc(r.child_name) + (r.grade ? ' <span class="muted">· ' + esc(r.grade) + '</span>' : '') + '</h2>' +
          '<p>Από: ' + who(r) + '</p>' +
          (r.message ? '<p>' + esc(r.message) + '</p>' : '') +
          '<p class="muted">' + esc(fmt(r.created_at)) + '</p>' +
          '<p><button class="primary" data-action="interest-accept" data-id="' + esc(r.id) + '">Αποδοχή</button> ' +
          '<button class="danger" data-action="interest-decline" data-id="' + esc(r.id) + '">Απόρριψη</button></p></div>';
      }).join('') : '<div class="card"><p class="empty">Κανένα αίτημα σε αναμονή.</p></div>') +
      (accepted.length ? '<h2>Ραντεβού γνωριμίας</h2>' +
        '<p class="muted">Αφού αποδεχτείς ένα αίτημα, κλείσε ραντεβού για να γνωριστείτε. Θα το δουν στο ημερολόγιό τους και θα μπουν με το κουμπί «Σύνδεση» στο δωμάτιό σου.</p>' +
        accepted.map(function (r) {
          return '<div class="card"><h2>' + esc(r.child_name) + '</h2><p>Γονέας: ' + who(r) + '</p>' +
            '<form data-form="add-intro" data-guest="' + esc(r.parent_id) + '" class="row">' +
            '<label class="field">Έναρξη<input name="start" type="datetime-local" value="' + esc(start) + '" required></label>' +
            '<label class="field">Διάρκεια (λεπτά)<input name="duration" type="number" min="15" max="240" step="15" value="30" required></label>' +
            '<label class="field">Σημείωση<input name="notes" maxlength="500"></label>' +
            '<button class="primary" type="submit">Κλείσε ραντεβού γνωριμίας</button></form></div>';
        }).join('') : '') +
      (done.length ? '<h2>Παλαιότερα</h2><div class="card"><table><tbody>' + done.map(function (r) {
        return '<tr><td>' + esc(r.child_name) + '</td><td>' + who(r) + '</td><td>' + esc(fmt(r.created_at)) + '</td>' +
          '<td><span class="badge ' + esc(r.status) + '">' + esc(App.REQ_STATUS[r.status]) + '</span>' +
          (r.student_id ? ' <a href="#/student/' + esc(r.student_id) + '">Άνοιγμα</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '');
  };

  App.forms['add-intro'] = async function (f) {
    var startD = new Date(f.elements['start'].value);
    if (isNaN(startD.getTime())) { throw new Error('Άκυρη ημερομηνία έναρξης.'); }
    var endD = new Date(startD.getTime() + Number(f.elements['duration'].value) * 60000);
    await must(sb.rpc('create_meeting', {
      p_guest: f.getAttribute('data-guest'),
      p_kind: 'intro',
      p_student: null,
      p_start: startD.toISOString(),
      p_end: endD.toISOString(),
      p_url: '',
      p_notes: f.elements['notes'].value.trim()
    }));
    App.toast('Το ραντεβού γνωριμίας προγραμματίστηκε. Φαίνεται στο ημερολόγιο.');
  };

  App.actions['interest-accept'] = async function (t) {
    await must(sb.rpc('respond_interest', { p_id: t.getAttribute('data-id'), p_accept: true }));
    App.toast('Το αίτημα έγινε αποδεκτό. Ο μαθητής προστέθηκε.');
    await App.pages.requests();
  };
  App.actions['interest-decline'] = async function (t) {
    await must(sb.rpc('respond_interest', { p_id: t.getAttribute('data-id'), p_accept: false }));
    await App.pages.requests();
  };
})();
