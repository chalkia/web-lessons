// Edge Function: νέος μαθητής με email. Στέλνει email για ορισμό κωδικού.
// Γιατί χρειάζεται: η αποστολή πρόσκλησης θέλει το κλειδί υπηρεσίας (service role), που ΔΕΝ μπαίνει ποτέ στη σελίδα.
// Οι έλεγχοι δικαιωμάτων γίνονται στη βάση (add_student_invite / pending_student_invite) με το token του εκπαιδευτικού.
// Είσοδος (JSON): { name, email, grade }  -> νέος μαθητής,  ή  { student_id } -> ξαναστέλνει πρόσκληση.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS),
  });
}

// Καθαρή λογική, χωρίς Deno, ώστε να δοκιμάζεται με ψεύτικους πελάτες (tools/edge-test).
async function handler(req, makeClient, env) {
  if (req.method === "OPTIONS") { return new Response(null, { status: 204, headers: CORS }); }
  if (req.method !== "POST") { return reply(405, { error: "Μόνο POST" }); }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) { return reply(401, { error: "Απαιτείται είσοδος" }); }

  let body;
  try { body = await req.json(); } catch (e) { return reply(400, { error: "Άκυρα δεδομένα" }); }

  // Πελάτης με το token του εκπαιδευτικού: το auth.uid() στη βάση είναι ο εκπαιδευτικός.
  const userClient = makeClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const who = await userClient.auth.getUser();
  if (who.error || !who.data || !who.data.user) { return reply(401, { error: "Η συνεδρία έληξε. Κάνε ξανά είσοδο." }); }

  let email;
  let name;
  let studentId = null;
  if (body && body.student_id) {
    const r = await userClient.rpc("pending_student_invite", { sid: body.student_id });
    if (r.error) { return reply(400, { error: r.error.message }); }
    if (!r.data) { return reply(400, { error: "Δεν υπάρχει εκκρεμής πρόσκληση για αυτόν τον μαθητή." }); }
    email = r.data;
    studentId = body.student_id;
    const sr = await userClient.from("students").select("full_name").eq("id", studentId).limit(1);
    name = sr.data && sr.data.length ? sr.data[0].full_name : email;
  } else {
    const r = await userClient.rpc("add_student_invite", {
      p_name: body && body.name, p_email: body && body.email, p_grade: (body && body.grade) || null,
    });
    if (r.error) { return reply(400, { error: r.error.message }); }
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) { return reply(400, { error: "Δεν δημιουργήθηκε ο μαθητής" }); }
    studentId = row.student_id;
    if (!row.send_invite) {
      // Το email έχει ήδη λογαριασμό: συνδέθηκε αμέσως, δεν χρειάζεται πρόσκληση.
      return reply(200, { student_id: studentId, invited: false });
    }
    email = String(body.email).trim().toLowerCase();
    name = String(body.name).trim();
  }

  const admin = makeClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const inv = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name, account_type: "student", invited: "true" },
  });
  if (inv.error) {
    // Ο μαθητής και η πρόσκληση έμειναν στη βάση: ο εκπαιδευτικός μπορεί να ξαναδοκιμάσει από τη σελίδα του μαθητή.
    return reply(502, { error: "Ο μαθητής προστέθηκε, αλλά το email δεν στάλθηκε: " + inv.error.message, student_id: studentId });
  }
  return reply(200, { student_id: studentId, invited: true });
}

// --- entry ---
Deno.serve((req) => handler(req, createClient, Deno.env.toObject()));
