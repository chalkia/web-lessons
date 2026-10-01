#!/bin/bash
# Δοκιμή δικαιωμάτων (RLS) του supabase/schema.sql σε τοπική PostgreSQL με απομιμήσεις του Supabase.
# Χρειάζεται εγκατεστημένη PostgreSQL (initdb, pg_ctl, psql) και χρήστη "postgres" του συστήματος.
# Χρήση:  sudo bash tools/db-test/run.sh
# Αποτέλεσμα: γραμμές PASS/FAIL. Μηδέν FAIL = εντάξει.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
B="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"; D=/tmp/pgtest-run; PORT=5498
rm -rf "$D"; mkdir -p "$D"; chown postgres "$D"
cp "$HERE/stubs.sql" "$HERE/behave.sql" "$ROOT/supabase/schema.sql" "$D/"; chmod a+r "$D"/*.sql
P="su postgres -s /bin/bash -c"
$P "$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log start >/dev/null"; sleep 2
trap "$P '$B/pg_ctl -D $D/data stop >/dev/null' || true" EXIT
Q="psql -h $D -p $PORT -q -v ON_ERROR_STOP=1"
$P "$Q -d postgres -c 'create database t'"
$P "$Q -d t -f $D/stubs.sql"; $P "$Q -d t -f $D/schema.sql" 2>&1 | grep -v NOTICE || true
$P "$Q -d t -c \"grant select,insert,update,delete on all tables in schema public to authenticated; grant select,insert,update,delete on all tables in schema storage to authenticated; grant usage on schema storage to authenticated; grant select on all tables in schema public to anon;\""
$P "$Q -d t -f $D/behave.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|CONTEXT" | sed 's/^psql:[^ ]* *//'
