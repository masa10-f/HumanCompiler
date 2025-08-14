import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('Supabase client initialization:', {
  url: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'undefined',
  key: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : 'undefined',
  nodeEnv: process.env.NODE_ENV
})

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = `Missing Supabase environment variables: URL=${!supabaseUrl ? 'missing' : 'present'}, KEY=${!supabaseAnonKey ? 'missing' : 'present'}`

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${errorMessage}. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.`);
  } else {
    console.error(`⚠️ ${errorMessage}`);
    console.warn('Using fallback values for development/build time');
  }
}

// Create Supabase client for client-side operations
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)
