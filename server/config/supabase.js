let supabaseServerClient

function getSupabaseServerClient() {
  if (supabaseServerClient) return supabaseServerClient

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for server-side Supabase operations')
  }

  const { createClient } = require('@supabase/supabase-js')
  supabaseServerClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return supabaseServerClient
}

module.exports = { getSupabaseServerClient }
