// Πυρήνας: βοηθητικά, ετικέτες, σύνδεση με Supabase, κοινή κατάσταση.
// Τα υπόλοιπα αρχεία (page-*.js, app.js) δηλώνουν σελίδες και ενέργειες πάνω στο window.App.
(function () {
  'use strict';

  var App = window.App = {
    pages: {},     // όνομα σελίδας -> async function
    actions: {},   // data-action -> function(button)
    forms: {},     // data-form -> async function(form)
    changes: {},   // data-change -> async function(select/checkbox)
    state: { session: null, profile: null, application: null, authMode: 'login', needPassword: false, authError: '' },
    ready: false
  };

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
    toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
  }

  function fmt(iso) {
    return new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function toLocalInput(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // Διάρκεια σε ώρες από ένα αντικείμενο με starts_at και ends_at.
  function hours(x) {
    return (new Date(x.ends_at) - new Date(x.starts_at)) / 3600000;
  }

  function nextHour() {
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  }

  // ---------- Ετικέτες ----------

  // Είδος λογαριασμού. Ο γονέας και ο βοηθός ΔΕΝ είναι είδη λογαριασμού: είναι σχέσεις ανά μαθητή.
  App.ROLE_LABEL = {
    admin: 'Διαχειριστής',
    teacher: 'Εκπαιδευτικός',
    student: 'Μαθητής / γονέας'
  };
  App.LESSON_STATUS = {
    planned: 'Προγραμματισμένο',
    done: 'Πραγματοποιήθηκε',
    cancelled: 'Ακυρώθηκε',
    absent: 'Απουσία'
  };
  App.SUPPORT_STATUS = {
    planned: 'Προγραμματισμένη',
    done: 'Πραγματοποιήθηκε',
    cancelled: 'Ακυρώθηκε'
  };
  // Σχέσεις ανά μαθητή που ορίζονται με email. Οι βοηθοί ορίζονται από τους συνεργάτες.
  App.RELATION_LABEL = {
    student: 'Μαθητής',
    parent: 'Γονέας'
  };
  App.APP_STATUS = {
    draft: 'Πρόχειρη',
    pending: 'Υπό έλεγχο',
    approved: 'Εγκεκριμένος',
    rejected: 'Απορρίφθηκε'
  };
  App.DOC_KIND = {
    degree: 'Πτυχίο',
    masters: 'Μεταπτυχιακό',
    phd: 'Διδακτορικό',
    certificate: 'Πιστοποιητικό',
    other: 'Άλλο'
  };
  App.MEETING_KIND = {
    intro: 'Γνωριμία',
    parent: 'Συνάντηση γονέα'
  };
  App.REQ_STATUS = {
    pending: 'Εκκρεμεί',
    accepted: 'Έγινε αποδεκτό',
    declined: 'Απορρίφθηκε'
  };

  App.el = el;
  App.esc = esc;
  App.safeUrl = safeUrl;
  App.toast = toast;
  App.fmt = fmt;
  App.toLocalInput = toLocalInput;
  App.hours = hours;
  App.nextHour = nextHour;

  // Ο σύνδεσμος του email (πρόσκληση ή επαναφορά) φέρνει τον χρήστη με #...type=invite|recovery.
  // Το κρατάμε ΠΡΙΝ δημιουργηθεί ο πελάτης Supabase, γιατί εκείνος καθαρίζει το hash.
  (function () {
    var h = location.hash || '';
    if (/[#&]type=(invite|recovery)\b/.test(h)) { App.state.needPassword = true; }
    if (/[#&]error_code=/.test(h)) {
      App.state.authError = /otp_expired/.test(h)
        ? 'Ο σύνδεσμος έληξε ή χρησιμοποιήθηκε ήδη. Πάτα «Ξέχασα τον κωδικό» για νέο email, ή ζήτησε από τον εκπαιδευτικό σου να το στείλει ξανά.'
        : 'Ο σύνδεσμος δεν είναι έγκυρος. Πάτα «Ξέχασα τον κωδικό» για νέο email.';
    }
  })();

  // ---------- Σύνδεση με Supabase ----------

  var cfg = window.APP_CONFIG;
  var view = el('view');
  App.view = view;

  if (!cfg || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('ΤΟ-PROJECT') !== -1) {
    view.innerHTML = '<div class="card narrow"><h2>Λείπει η ρύθμιση</h2>' +
      '<p>Άνοιξε το <code>js/config.js</code> και βάλε το URL και το anon key του Supabase.</p></div>';
    return;
  }
  if (!window.supabase) {
    view.innerHTML = '<div class="card narrow"><h2>Σφάλμα</h2><p>Δεν φορτώθηκε η βιβλιοθήκη Supabase. Έλεγξε τη σύνδεσή σου.</p></div>';
    return;
  }

  App.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Επιστρέφει τα δεδομένα ή πετά σφάλμα με το μήνυμα της βάσης (ποτέ σιωπηλή αποτυχία).
  App.must = async function (promise) {
    var r = await promise;
    if (r.error) { throw new Error(r.error.message); }
    return r.data;
  };

  // Κλήση της Edge Function invite-student. Το μήνυμα σφάλματος της συνάρτησης περνά αυτούσιο.
  App.inviteStudent = async function (body) {
    var r = await App.sb.functions.invoke('invite-student', { body: body });
    if (r.error) {
      var msg = r.error.message;
      try {
        var j = await r.error.context.json();
        if (j && j.error) { msg = j.error; }
      } catch (e) { /* κρατάμε το γενικό μήνυμα */ }
      throw new Error(msg);
    }
    return r.data;
  };

  App.run = async function (fn) {
    try { await fn(); } catch (e) { console.error(e); toast('Σφάλμα: ' + e.message); }
  };

  // ---------- Δικαιώματα (για την εμφάνιση· την πραγματική προστασία την κάνει η βάση) ----------

  App.isAdmin = function () {
    return !!App.state.profile && App.state.profile.role === 'admin';
  };
  App.isTeacher = function () {
    return !!App.state.profile && App.state.profile.role === 'teacher';
  };
  // Μπορεί να λειτουργήσει ως εκπαιδευτικός: διαχειριστής ή εγκεκριμένος εκπαιδευτικός.
  App.canTeach = function () {
    var st = App.state;
    if (!st.profile) { return false; }
    if (st.profile.role === 'admin') { return true; }
    return st.profile.role === 'teacher' && !!st.application && st.application.status === 'approved';
  };
  // Μπορεί να στείλει αίτημα συνεργασίας σε εκπαιδευτικό (γονέας ή ενήλικος μαθητής).
  App.canRequest = function () {
    return !!App.state.profile && App.state.profile.role === 'student' && !!App.state.profile.can_request;
  };
  // Μπορεί να αλλάξει αυτό που ανήκει σε αυτόν τον εκπαιδευτικό; Ο βοηθός βλέπει, δεν αλλάζει.
  App.ownsTeacher = function (teacherId) {
    return !!App.state.profile && (App.state.profile.role === 'admin' || App.state.profile.id === teacherId);
  };

  // Ονόματα (όχι email) εκπαιδευτικών και βοηθών που σχετίζονται με μαθητές που βλέπω.
  App.names = async function (ids) {
    var uniq = [];
    ids.forEach(function (id) { if (id && uniq.indexOf(id) === -1) { uniq.push(id); } });
    var map = {};
    if (!uniq.length) { return map; }
    var rows = await App.must(App.sb.rpc('names_for', { ids: uniq }));
    rows.forEach(function (r) { map[r.id] = r.full_name; });
    return map;
  };

  // Δωμάτια (σύνδεσμοι) εκπαιδευτικών: id -> url.
  App.rooms = async function (ids) {
    var uniq = [];
    ids.forEach(function (id) { if (id && uniq.indexOf(id) === -1) { uniq.push(id); } });
    var map = {};
    if (!uniq.length) { return map; }
    var rows = await App.must(App.sb.rpc('rooms_for', { ids: uniq }));
    rows.forEach(function (r) { map[r.id] = r.room_url; });
    return map;
  };

  // Σύνδεσμος σύνδεσης για μάθημα ή ώρα υποστήριξης: πρώτα ο ειδικός σύνδεσμος της συνεδρίας,
  // αλλιώς το δωμάτιο του εκπαιδευτικού που τη διδάσκει (host = teacher_id ή assistant_id).
  App.joinUrl = function (item, rooms, hostId) {
    return App.safeUrl(item.meeting_url) || App.safeUrl(rooms[hostId]) || '';
  };

  // Κουμπί σύνδεσης: ανοίγει σε νέο παράθυρο.
  App.joinButton = function (url) {
    if (!url) { return '<span class="muted">Δεν έχει οριστεί δωμάτιο</span>'; }
    return '<a class="btn primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Σύνδεση</a>';
  };

  App.ready = true;
})();
