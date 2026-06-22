import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

logger.debug('Supabase client initialization', {
  url: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'undefined',
  key: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : 'undefined',
  nodeEnv: process.env.NODE_ENV
}, { component: 'supabase' })

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = `Missing Supabase environment variables: URL=${!supabaseUrl ? 'missing' : 'present'}, KEY=${!supabaseAnonKey ? 'missing' : 'present'}`

  logger.error(errorMessage, { component: 'supabase' });
  logger.warn('Using fallback Supabase values for static build/rendering', { component: 'supabase' });
}

// Create Supabase client for client-side operations
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)
