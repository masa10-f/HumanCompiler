// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { notesApi } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { AttachmentUrlResolver } from './attachment-urls';

/** The signed URLs of note images, shared by every note on the page. */
export const noteAttachmentUrls = new AttachmentUrlResolver((ids) =>
  notesApi.getAttachmentUrls(ids)
);

/**
 * Forget the URLs when the signed-in user changes (sign-out, or another user
 * signing in in the same tab). A token refresh keeps the user and the URLs.
 */
export function clearOnUserChange(
  resolver: AttachmentUrlResolver,
  auth: Pick<typeof supabase.auth, 'onAuthStateChange'>
): void {
  let userId: string | null | undefined;
  auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    if (next !== userId) {
      userId = next;
      resolver.clear();
    }
  });
}

clearOnUserChange(noteAttachmentUrls, supabase.auth);
