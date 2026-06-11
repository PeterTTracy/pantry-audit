// Supabase client for the pantry-audit project (MIT Culinary Tools org).
// This is a single-user personal tool with open anon-key access — the
// publishable key is designed to be embedded in client apps and is safe to
// ship in the bundle. RLS policies grant the anon role full access.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://kagfnnzaboxghfegingr.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_9imHsUszxPHpiPZO0aLg-w_oenENnjF';
export const PHOTO_BUCKET = 'label-photos';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }, // no auth flow; anon role only
});
