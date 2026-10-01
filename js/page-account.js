// Λογαριασμός: είσοδος/εγγραφή, πλοήγηση, πιστοποιητικά εκπαιδευτικού, εγκρίσεις και χρήστες (διαχειριστής).
(function () {
  'use strict';
  if (!window.App || !App.ready) { return; }

  var sb = App.sb, must = App.must, el = App.el, esc = App.esc, fmt = App.fmt, view = App.view;
  var BUCKET = 'credentials';
  var MAX_FILE = 5 * 1024 * 1024;

  // ---------- Είσοδος / εγγραφή ----------

  App.renderAuth = function () {
    el('topbar').hidden = true;
    var reg = App.state.authMode === 'register';
    view.innerHTML =
      '<div class="card narrow">' +
      '<h1>' + (reg ? 'Εγγραφή' : 'Είσοδος') + '</h1>' +
      '<form data-form="auth">' +
      (reg ? '<label for="a-name">Ονοματεπώνυμο</label><input id="a-name" name="name" required>' : '') +
      (reg ? '<label for="a-type">Εγγράφομαι ως</label><select id="a-type" name="account_type">' +
        '<option value="student">Μαθητής ή γονέας</option>' +
        '<option value="teacher">Εκπαιδευτικός (απαιτεί έγκριση)</option></select>' : '') +
      '<label for="a-email">Email</label><input id="a-email" name="email" type="email" required>' +
      '<label for="a-pass">Κωδικός</label><input id="a-pass" name="password" type="password" minlength="8" required>' +
      '<p><button class="primary" type="submit">' + (reg ? 'Εγγραφή' : 'Είσοδος') + '</button></p>' +
      '</form>' +
      '<p class="muted">' + (reg
        ? 'Έχεις λογαριασμό; <a href="#" data-action="toggle-auth">Είσοδος</a>'
        : 'Νέος χρήστης; <a href="#" data-action="toggle-auth">Εγγραφή</a>') + '</p>' +
      (reg ? '<p class="muted">Αν σε έχει προσκαλέσει εκπαιδευτικός, γράψε το ίδιο email που του έδωσες. Έτσι συνδέεσαι αυτόματα με τον μαθητή.</p>' : '') +
      '</div>';
  };

  App.actions['toggle-auth'] = function () {
    App.state.authMode = App.state.authMode === 'login' ? 'register' : 'login';
    App.renderAuth();
  };

  App.forms['auth'] = async function (f) {
    var email = f.elements['email'].value.trim();
    var password = f.elements['password'].value;
    if (App.state.authMode === 'register') {
      var name = f.elements['name'].value.trim();
      var type = f.elements['account_type'].value;
      var r = await sb.auth.signUp({
        email: email, password: password,
        options: { data: { full_name: name, account_type: type } }
      });
      if (r.error) { throw new Error(r.error.message); }
      if (!r.data.session) {
        App.toast('Έλεγξε το email σου για επιβεβαίωση και μετά κάνε είσοδο.');
        App.state.authMode = 'login';
        App.renderAuth();
      }
    } else {
      var l = await sb.auth.signInWithPassword({ email: email, password: password });
      if (l.error) { throw new Error(l.error.message); }
    }
  };

  // ---------- Πλοήγηση ----------

  App.renderNav = function (active) {
    var st = App.state;
    var role = st.profile.role;
    var items = [['#/', 'Αρχική', 'home']];
    if (role === 'teacher') { items.push(['#/credentials', 'Πιστοποιητικά', 'credentials']); }
    if (App.canTeach()) { items.push(['#/students', 'Μαθητές', 'students']); }
    if (role === 'teacher' && App.canTeach()) {
      items.push(['#/requests', 'Αιτήματα', 'requests']);
      items.push(['#/teachers', 'Συνεργάτες', 'teachers']);
    }
    items.push(['#/calendar', 'Ημερολόγιο', 'calendar']);
    items.push(['#/personal', 'Προσωπικό', 'personal']);
    if (role === 'student') { items.push(['#/teachers', 'Εκπαιδευτικοί', 'teachers']); }
    if (role === 'admin') {
      items.push(['#/approvals', 'Εγκρίσεις', 'approvals']);
      items.push(['#/users', 'Χρήστες', 'users']);
    }
    el('nav').innerHTML = items.map(function (i) {
      return '<a href="' + i[0] + '"' + (i[2] === active ? ' class="active"' : '') + '>' + esc(i[1]) + '</a>';
    }).join('');
    var tag = App.ROLE_LABEL[role];
    if (role === 'teacher' && !App.canTeach()) { tag += ' (σε αναμονή έγκρισης)'; }
    el('whoami').textContent = st.profile.full_name + ' · ' + tag;
    el('topbar').hidden = false;
  };

  // ---------- Αίτηση / πιστοποιητικά εκπαιδευτικού ----------

  App.loadApplication = async function () {
    var st = App.state;
    if (!st.profile || st.profile.role !== 'teacher') { st.application = null; return null; }
    var rows = await must(sb.from('teacher_applications')
      .select('user_id, status, subjects, bio, review_note')
      .eq('user_id', st.profile.id).limit(1));
    st.application = rows.length ? rows[0] : null;
    return st.application;
  };

  App.pages.credentials = async function () {
    var st = App.state;
    if (st.profile.role !== 'teacher') { location.hash = '#/'; return; }
    var a = await App.loadApplication();
    App.renderNav('credentials');
    var status = a ? a.status : 'draft';
    var editable = status === 'draft' || status === 'rejected';
    var docs = await must(sb.from('teacher_documents')
      .select('id, kind, file_path, file_name, created_at').order('created_at'));

    var banner;
    if (status === 'approved') {
      banner = '<p><span class="badge approved">Εγκεκριμένος</span> Μπορείς να προσθέτεις μαθητές, να δέχεσαι αιτήματα και να προσκαλείς συνεργάτες.</p>';
    } else if (status === 'pending') {
      banner = '<p><span class="badge pending">Υπό έλεγχο</span> Ο διαχειριστής ελέγχει την αίτησή σου. Δεν μπορείς να αλλάξεις τα πιστοποιητικά όσο διαρκεί ο έλεγχος.</p>';
    } else if (status === 'rejected') {
      banner = '<p><span class="badge rejected">Απορρίφθηκε</span> ' + esc(a.review_note || '') + '</p>' +
        '<p class="muted">Μπορείς να διορθώσεις τα στοιχεία, να προσθέσεις πιστοποιητικά και να υποβάλεις ξανά.</p>';
    } else {
      banner = '<p>Για να διδάξεις στην πλατφόρμα χρειάζεται έγκριση. Συμπλήρωσε τα στοιχεία σου, ανέβασε τα πιστοποιητικά σου (πτυχίο, μεταπτυχιακά κ.λπ.) και υπέβαλε την αίτηση.</p>';
    }

    view.innerHTML =
      '<h1>Πιστοποιητικά και έγκριση</h1>' +
      '<div class="card">' + banner + '</div>' +
      '<div class="card"><h2>Στοιχεία εκπαιδευτικού</h2>' +
      '<p class="muted">Τα βλέπουν οι άλλοι εγκεκριμένοι εκπαιδευτικοί και οι γονείς, στον κατάλογο.</p>' +
      '<form data-form="save-application">' +
      '<label for="ap-subjects">Αντικείμενα διδασκαλίας</label>' +
      '<input id="ap-subjects" name="subjects" maxlength="200" value="' + esc(a ? a.subjects : '') + '" placeholder="π.χ. Φυσική, Μαθηματικά Λυκείου" required>' +
      '<label for="ap-bio">Σύντομο βιογραφικό</label>' +
      '<textarea id="ap-bio" name="bio" rows="4" maxlength="1000">' + esc(a ? a.bio : '') + '</textarea>' +
      '<p><button class="primary" type="submit">Αποθήκευση</button></p></form></div>' +
      '<div class="card"><h2>Πιστοποιητικά</h2>' +
      '<p class="muted">Τα βλέπει μόνο ο διαχειριστής. Αρχεία PDF, JPG ή PNG, έως 5 MB το καθένα.</p>' +
      (docs.length
        ? '<table><tbody>' + docs.map(function (d) {
          return '<tr><td>' + esc(d.file_name) + '</td><td>' + esc(App.DOC_KIND[d.kind]) + '</td><td>' + esc(fmt(d.created_at)) + '</td>' +
            '<td>' + (editable
              ? '<button class="danger" data-action="delete-doc" data-id="' + esc(d.id) + '" data-path="' + esc(d.file_path) + '">Διαγραφή</button>'
              : '') + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="empty">Δεν έχεις ανεβάσει ακόμη αρχεία.</p>') +
      (editable
        ? '<form data-form="upload-doc" class="row">' +
        '<div><label for="up-kind">Είδος</label><select id="up-kind" name="kind">' +
        Object.keys(App.DOC_KIND).map(function (k) { return '<option value="' + k + '">' + esc(App.DOC_KIND[k]) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label for="up-file">Αρχείο</label><input id="up-file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required></div>' +
        '<button class="primary" type="submit">Ανέβασμα</button></form>'
        : '') +
      '</div>' +
      (editable
        ? '<div class="card"><h2>Υποβολή</h2>' +
        (docs.length ? '' : '<p class="muted">Ανέβασε πρώτα τουλάχιστον ένα πιστοποιητικό.</p>') +
        '<button class="primary" data-action="submit-application"' + (docs.length ? '' : ' disabled') + '>Υποβολή για έγκριση</button></div>'
        : '');
  };

  App.forms['save-application'] = async function (f) {
    await must(sb.rpc('save_application', {
      p_subjects: f.elements['subjects'].value.trim(),
      p_bio: f.elements['bio'].value.trim()
    }));
    App.toast('Αποθηκεύτηκε.');
    await App.pages.credentials();
  };

  App.forms['upload-doc'] = async function (f) {
    var file = f.elements['file'].files[0];
    if (!file) { throw new Error('Διάλεξε αρχείο.'); }
    if (file.size > MAX_FILE) { throw new Error('Το αρχείο ξεπερνά τα 5 MB.'); }
    var uid = App.state.profile.id;
    // Το όνομα στο Storage είναι ασφαλές (χωρίς ελληνικά/κενά). Το πραγματικό όνομα μένει στη βάση.
    var safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    var path = uid + '/' + Date.now() + '-' + safe;
    var up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) { throw new Error(up.error.message); }
    var ins = await sb.from('teacher_documents').insert({
      user_id: uid,
      kind: f.elements['kind'].value,
      file_path: path,
      file_name: file.name
    });
    if (ins.error) {
      await sb.storage.from(BUCKET).remove([path]);
      throw new Error(ins.error.message);
    }
    App.toast('Το αρχείο ανέβηκε.');
    await App.pages.credentials();
  };

  App.actions['delete-doc'] = async function (t) {
    var rows = await must(sb.from('teacher_documents').delete().eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Δεν επιτρέπεται η διαγραφή αυτού του αρχείου.'); }
    var rm = await sb.storage.from(BUCKET).remove([t.getAttribute('data-path')]);
    if (rm.error) { console.error(rm.error); }
    await App.pages.credentials();
  };

  App.actions['submit-application'] = async function () {
    await must(sb.rpc('submit_application'));
    App.toast('Η αίτηση υποβλήθηκε.');
    await App.pages.credentials();
  };

  // ---------- Εγκρίσεις (διαχειριστής) ----------

  function reviewCard(a, p, docs, urls, canApprove) {
    var links = docs.length
      ? docs.map(function (d) {
        var u = App.safeUrl(urls[d.file_path]);
        var label = esc(d.file_name) + ' (' + esc(App.DOC_KIND[d.kind]) + ')';
        return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
      }).join('<br>')
      : '<span class="muted">Κανένα αρχείο.</span>';
    return '<div class="card" data-card="' + esc(a.user_id) + '">' +
      '<h2>' + esc(p ? p.full_name : '—') + ' <span class="muted">(' + esc(p ? p.email : '') + ')</span></h2>' +
      '<p><strong>Αντικείμενα:</strong> ' + esc(a.subjects) + '</p>' +
      '<p><strong>Βιογραφικό:</strong> ' + esc(a.bio) + '</p>' +
      '<p><strong>Πιστοποιητικά:</strong><br>' + links + '</p>' +
      '<label>Σημείωση (υποχρεωτική για απόρριψη ή ανάκληση)<input name="note" maxlength="300"></label>' +
      '<p>' + (canApprove ? '<button class="primary" data-action="approve-application" data-id="' + esc(a.user_id) + '">Έγκριση</button> ' : '') +
      '<button class="danger" data-action="reject-application" data-id="' + esc(a.user_id) + '">' + (canApprove ? 'Απόρριψη' : 'Ανάκληση έγκρισης') + '</button></p></div>';
  }

  App.pages.approvals = async function () {
    App.renderNav('approvals');
    if (!App.isAdmin()) { location.hash = '#/'; return; }
    var apps = await must(sb.from('teacher_applications')
      .select('user_id, status, subjects, bio, submitted_at')
      .in('status', ['pending', 'approved']).order('submitted_at'));
    var ids = apps.map(function (a) { return a.user_id; });
    var profs = ids.length ? await must(sb.from('profiles').select('id, full_name, email').in('id', ids)) : [];
    var docs = ids.length ? await must(sb.from('teacher_documents').select('id, user_id, kind, file_path, file_name').in('user_id', ids)) : [];

    // Σύνδεσμοι λήψης με λήξη μίας ώρας. Τα αρχεία είναι σε ιδιωτικό bucket.
    var urls = {};
    if (docs.length) {
      var signed = await sb.storage.from(BUCKET).createSignedUrls(docs.map(function (d) { return d.file_path; }), 3600);
      if (signed.error) { throw new Error(signed.error.message); }
      signed.data.forEach(function (x) { if (x.signedUrl) { urls[x.path] = x.signedUrl; } });
    }
    var byId = {};
    profs.forEach(function (p) { byId[p.id] = p; });
    function render(list, canApprove) {
      return list.map(function (a) {
        return reviewCard(a, byId[a.user_id], docs.filter(function (d) { return d.user_id === a.user_id; }), urls, canApprove);
      }).join('');
    }
    var pending = apps.filter(function (a) { return a.status === 'pending'; });
    var approved = apps.filter(function (a) { return a.status === 'approved'; });

    view.innerHTML =
      '<h1>Εγκρίσεις εκπαιδευτικών</h1>' +
      '<h2>Προς έλεγχο (' + pending.length + ')</h2>' +
      (pending.length ? render(pending, true) : '<div class="card"><p class="empty">Καμία αίτηση σε αναμονή.</p></div>') +
      '<h2>Εγκεκριμένοι (' + approved.length + ')</h2>' +
      (approved.length ? render(approved, false) : '<div class="card"><p class="empty">Κανένας ακόμη.</p></div>');
  };

  async function review(t, approve) {
    var card = t.closest('[data-card]');
    var note = card.querySelector('input[name="note"]').value.trim();
    await must(sb.rpc('review_application', {
      p_user: t.getAttribute('data-id'),
      p_approve: approve,
      p_note: note
    }));
    App.toast(approve ? 'Εγκρίθηκε.' : 'Απορρίφθηκε.');
    await App.pages.approvals();
  }
  App.actions['approve-application'] = function (t) { return review(t, true); };
  App.actions['reject-application'] = function (t) { return review(t, false); };

  // ---------- Χρήστες (διαχειριστής) ----------

  App.pages.users = async function () {
    App.renderNav('users');
    if (!App.isAdmin()) { location.hash = '#/'; return; }
    var users = await must(sb.from('profiles').select('id, email, full_name, role, created_at').order('created_at', { ascending: false }));
    var apps = await must(sb.from('teacher_applications').select('user_id, status'));
    var appBy = {};
    apps.forEach(function (a) { appBy[a.user_id] = a.status; });
    view.innerHTML =
      '<h1>Χρήστες</h1><div class="card">' +
      '<p class="muted">Οι νέοι χρήστες διαλέγουν μόνοι τους «Εκπαιδευτικός» ή «Μαθητής / γονέας». Ο ρόλος «Διαχειριστής» δίνεται μόνο από εδώ. Η έγκριση εκπαιδευτών γίνεται από τη σελίδα Εγκρίσεις.</p>' +
      '<table><thead><tr><th>Όνομα</th><th>Email</th><th>Ρόλος</th><th>Έγκριση</th></tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr><td>' + esc(u.full_name) + '</td><td>' + esc(u.email) + '</td><td>' +
          '<select data-change="user-role" data-id="' + esc(u.id) + '"' + (u.id === App.state.profile.id ? ' disabled' : '') + '>' +
          Object.keys(App.ROLE_LABEL).map(function (k) {
            return '<option value="' + k + '"' + (k === u.role ? ' selected' : '') + '>' + esc(App.ROLE_LABEL[k]) + '</option>';
          }).join('') + '</select></td>' +
          '<td>' + (u.role === 'teacher' ? esc(App.APP_STATUS[appBy[u.id] || 'draft']) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  };

  App.changes['user-role'] = async function (t) {
    var rows = await must(sb.from('profiles').update({ role: t.value }).eq('id', t.getAttribute('data-id')).select('id'));
    if (!rows.length) { throw new Error('Η αλλαγή δεν εφαρμόστηκε.'); }
    App.toast('Ο ρόλος άλλαξε.');
  };
})();
