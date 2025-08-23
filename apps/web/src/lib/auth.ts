import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export interface AuthUser {
  id: string
  email: string
  name?: string
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`
    }
  })

  if (error) throw error
  return data
}

export async function signIn(email: string, password: string) {
  console.log('🔑 Attempting sign in with:', { email, passwordLength: password.length })

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('❌ Supabase sign in error:', {
        message: error.message,
        status: error.status,
        name: error.name
      })
      throw new Error(error.message || 'ログインに失敗しました')
    }

    console.log('✅ Sign in successful:', { userId: data.user?.id })
    return data
  } catch (error) {
    console.error('❌ Sign in failed:', error)
    throw error
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })

  if (error) throw error
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({
    password,
  })

  if (error) throw error
}

// Helper to check if user is authenticated
export function isAuthenticated(user: User | null): user is User {
  return user !== null
}

// Get authentication headers for API requests
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('No authentication token available')
  }

  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}
