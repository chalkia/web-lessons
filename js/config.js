// Συμπλήρωσε τις δύο τιμές από το Supabase: Project Settings > API.
// Το "anon key" είναι δημόσιο από σχεδιασμό. Την ασφάλεια την κάνουν οι κανόνες RLS
// στο supabase/schema.sql. ΠΟΤΕ μην βάλεις εδώ το "service_role" κλειδί.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ΤΟ-PROJECT-ΣΟΥ.supabase.co',
  SUPABASE_ANON_KEY: 'ΤΟ-ANON-KEY-ΣΟΥ'
};
