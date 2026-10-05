// Δοκιμή της Edge Function invite-student με ψεύτικους πελάτες Supabase (χωρίς δίκτυο, χωρίς Deno).
// Τρέξε: node tools/edge-test/run.js   Μηδέν FAIL = εντάξει.
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'invite-student', 'index.ts'), 'utf8');
src = src.split('// --- entry ---')[0].replace(/^import .*$/m, '');
const handler = new Function('Response', src + '\nreturn handler;')(Response);

let fails = 0;
function ok(label, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) { fails++; } }

function req(method, headers, body) {
  return new Request('http://x/', { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
}
const ENV = { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE' };

// Ψεύτικος πελάτης. calls: καταγραφή. cfg: τι επιστρέφουν οι rpc.
function factory(cfg, calls) {
  return function (url, key, opts) {
    const isAdmin = key === 'SERVICE';
    return {
      auth: {
        getUser: async () => cfg.user ? { data: { user: cfg.user }, error: null } : { data: null, error: { message: 'bad jwt' } },
        admin: { inviteUserByEmail: async (email, o) => { calls.push({ invite: email, o }); return cfg.inviteError ? { error: { message: cfg.inviteError } } : { data: {}, error: null }; } },
      },
      rpc: async (n, a) => { calls.push({ rpc: n, a, asAdmin: isAdmin }); return cfg.rpc[n]; },
      from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ full_name: 'Μαρία' }], error: null }) }) }) }),
    };
  };
}
async function run(r, cfg) {
  const calls = [];
  const res = await handler(r, factory(cfg, calls), ENV);
  let json = null;
  try { json = await res.json(); } catch (e) { /* 204 */ }
  return { status: res.status, json, calls, headers: res.headers };
}
const AUTH = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
const T = { id: 't1' };

(async () => {
  let r = await run(req('OPTIONS', {}), {});
  ok('OPTIONS: 204 και CORS', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === '*');
  r = await run(req('GET', AUTH), {});
  ok('GET απορρίπτεται', r.status === 405);
  r = await run(req('POST', { 'Content-Type': 'application/json' }, { name: 'A', email: 'a@x.gr' }), { user: T });
  ok('χωρίς Authorization: 401', r.status === 401 && r.calls.length === 0);
  r = await run(req('POST', AUTH, 'όχι json'), { user: T });
  ok('άκυρο JSON: 400', r.status === 400);
  r = await run(req('POST', AUTH, { name: 'A', email: 'a@x.gr' }), { user: null });
  ok('άκυρο token: 401, δεν καλείται η βάση', r.status === 401 && !r.calls.some(c => c.rpc));

  r = await run(req('POST', AUTH, { name: 'Μαρία', email: ' Maria@X.gr ', grade: 'Β' }), { user: T, rpc: { add_student_invite: { data: [{ student_id: 's1', send_invite: true }], error: null } } });
  ok('νέος μαθητής: 200 invited', r.status === 200 && r.json.invited === true && r.json.student_id === 's1');
  const inv = r.calls.find(c => c.invite);
  ok('το email πρόσκλησης είναι καθαρό (πεζά, χωρίς κενά)', inv && inv.invite === 'maria@x.gr');
  ok('τα metadata έχουν invited και student', inv && inv.o.data.invited === 'true' && inv.o.data.account_type === 'student' && inv.o.data.full_name === 'Μαρία');
  ok('το rpc έτρεξε με το token του χρήστη, όχι με service', r.calls.find(c => c.rpc === 'add_student_invite').asAdmin === false);

  r = await run(req('POST', AUTH, { name: 'Μαρία', email: 'p1@x.gr' }), { user: T, rpc: { add_student_invite: { data: [{ student_id: 's2', send_invite: false }], error: null } } });
  ok('υπάρχων λογαριασμός: χωρίς email πρόσκλησης', r.status === 200 && r.json.invited === false && !r.calls.some(c => c.invite));

  r = await run(req('POST', AUTH, { name: 'Χ', email: 'a@x.gr' }), { user: T, rpc: { add_student_invite: { data: null, error: { message: 'Χρειάζεται εγκεκριμένος εκπαιδευτικός' } } } });
  ok('σφάλμα βάσης: 400 με μήνυμα, χωρίς πρόσκληση', r.status === 400 && /εγκεκριμένος/.test(r.json.error) && !r.calls.some(c => c.invite));

  r = await run(req('POST', AUTH, { name: 'Μαρία', email: 'a@x.gr' }), { user: T, inviteError: 'rate limit', rpc: { add_student_invite: { data: [{ student_id: 's3', send_invite: true }], error: null } } });
  ok('αποτυχία email: 502, επιστρέφει student_id', r.status === 502 && r.json.student_id === 's3' && /rate limit/.test(r.json.error));

  r = await run(req('POST', AUTH, { student_id: 's3' }), { user: T, rpc: { pending_student_invite: { data: 'a@x.gr', error: null } } });
  ok('επαναποστολή: χρησιμοποιεί το email της εκκρεμούς πρόσκλησης', r.status === 200 && r.calls.find(c => c.invite).invite === 'a@x.gr');
  r = await run(req('POST', AUTH, { student_id: 's3' }), { user: T, rpc: { pending_student_invite: { data: null, error: null } } });
  ok('επαναποστολή χωρίς εκκρεμή πρόσκληση: 400', r.status === 400 && !r.calls.some(c => c.invite));
  r = await run(req('POST', AUTH, { student_id: 's9' }), { user: T, rpc: { pending_student_invite: { data: null, error: { message: 'Δεν έχεις δικαίωμα' } } } });
  ok('επαναποστολή σε ξένο μαθητή: 400', r.status === 400 && !r.calls.some(c => c.invite));

  console.log(fails ? 'ΑΠΟΤΥΧΙΕΣ: ' + fails : 'OK: όλα τα τεστ της Edge Function πέρασαν');
  process.exit(fails ? 1 : 0);
})();
