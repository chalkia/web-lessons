// Εκκίνηση: σύνδεση χρήστη, φόρτωση προφίλ, δρομολόγηση (hash) και κοινοί χειριστές συμβάντων.
(function () {
  'use strict';
  if (!window.App || !App.ready) { return; }

  var sb = App.sb, must = App.must, el = App.el, state = App.state, view = App.view;

  async function loadProfile() {
    var uid = state.session.user.id;
    var rows = await must(sb.from('profiles').select('id, full_name, email, role, can_request, accepting_requests, accepting_collabs').eq('id', uid).limit(1));
    if (!rows.length) { throw new Error('Δεν βρέθηκε το προφίλ σου. Δοκίμασε ξανά ή επικοινώνησε με τον διαχειριστή.'); }
    state.profile = rows[0];
    await App.loadApplication();
  }

  async function route() {
    if (!state.session) {
      state.profile = null;
      state.application = null;
      App.renderAuth();
      return;
    }
    if (state.needPassword) { App.renderSetPassword(); return; }
    if (!state.profile) { await loadProfile(); }

    var hash = (location.hash || '#/').replace(/^#\/?/, '');
    var parts = hash.split('/');
    var name = parts[0] || 'home';
    if (name === 'student' && parts[1]) {
      await App.pages.student(decodeURIComponent(parts[1]));
      return;
    }
    if (!App.pages[name] || name === 'student') {
      view.innerHTML = '<div class="card narrow"><h2>Δεν βρέθηκε η σελίδα</h2><p><a href="#/">Αρχική</a></p></div>';
      App.renderNav('');
      return;
    }
    await App.pages[name]();
  }
  App.route = route;

  // Κοινοί χειριστές με delegation: κάθε ενέργεια δηλώνεται στο αντίστοιχο page-*.js.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) { return; }
    var name = t.getAttribute('data-action');
    if (!App.actions[name]) { console.error('Άγνωστη ενέργεια: ' + name); return; }
    e.preventDefault();
    App.run(function () { return App.actions[name](t); });
  });

  document.addEventListener('submit', function (e) {
    var f = e.target.closest ? e.target.closest('form[data-form]') : null;
    if (!f) { return; }
    e.preventDefault();
    var name = f.getAttribute('data-form');
    if (!App.forms[name]) { console.error('Άγνωστη φόρμα: ' + name); return; }
    App.run(function () { return App.forms[name](f); });
  });

  document.addEventListener('change', function (e) {
    var t = e.target.closest ? e.target.closest('[data-change]') : null;
    if (!t) { return; }
    var name = t.getAttribute('data-change');
    if (!App.changes[name]) { console.error('Άγνωστη αλλαγή: ' + name); return; }
    App.run(function () { return App.changes[name](t); });
  });

  el('btn-logout').addEventListener('click', function () {
    App.run(async function () { await sb.auth.signOut(); });
  });

  window.addEventListener('hashchange', function () { App.run(route); });

  sb.auth.onAuthStateChange(function (event, session) {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { state.needPassword = true; }
    if (!session) { state.profile = null; state.application = null; }
    // setTimeout: η Supabase προειδοποιεί να μην τρέχουν κλήσεις βάσης μέσα στο callback (κίνδυνος κλειδώματος).
    setTimeout(function () { App.run(route); }, 0);
  });
})();
