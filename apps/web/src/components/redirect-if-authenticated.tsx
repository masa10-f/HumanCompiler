// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'

/**
 * Sends signed-in users from public entry pages (landing, login) to the dashboard.
 * Without this, an installed PWA that launches at "/" looks logged out even though
 * the Supabase session is still stored.
 *
 * @param props - Component props
 * @param props.to - Destination for authenticated users
 */
export function RedirectIfAuthenticated({ to = '/dashboard' }: { to?: string }) {
  const { loading, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace(to)
    }
  }, [loading, isAuthenticated, router, to])

  return null
}
