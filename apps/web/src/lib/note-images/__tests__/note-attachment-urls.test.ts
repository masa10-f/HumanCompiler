// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { AttachmentUrlResolver } from '../attachment-urls';
import { clearOnUserChange } from '../note-attachment-urls';

jest.mock('@/lib/api', () => ({ notesApi: { getAttachmentUrls: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn() } },
}));

type Listener = (event: string, session: { user: { id: string } } | null) => void;

function listen() {
  const resolver = new AttachmentUrlResolver(jest.fn());
  const clear = jest.spyOn(resolver, 'clear');
  let listener: Listener = () => {};
  clearOnUserChange(resolver, {
    onAuthStateChange: ((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }) as never,
  });
  return { clear, emit: (event: string, userId: string | null) =>
    listener(event, userId === null ? null : { user: { id: userId } }) };
}

describe('clearOnUserChange', () => {
  it('forgets the URLs when the user signs out or another signs in', () => {
    const { clear, emit } = listen();

    emit('INITIAL_SESSION', 'user-a');
    expect(clear).toHaveBeenCalledTimes(1);

    emit('SIGNED_OUT', null);
    expect(clear).toHaveBeenCalledTimes(2);

    emit('SIGNED_IN', 'user-b');
    expect(clear).toHaveBeenCalledTimes(3);
  });

  it('keeps the URLs while the same user stays signed in', () => {
    const { clear, emit } = listen();
    emit('INITIAL_SESSION', 'user-a');

    emit('TOKEN_REFRESHED', 'user-a');
    emit('SIGNED_IN', 'user-a');
    emit('USER_UPDATED', 'user-a');

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('is set up for the resolver the notes use', async () => {
    // Loaded afresh: the listener is registered when the module is first read.
    jest.resetModules();
    const { supabase } = await import('@/lib/supabase');
    const { noteAttachmentUrls } = await import('../note-attachment-urls');
    const clear = jest.spyOn(noteAttachmentUrls, 'clear');

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    const listener = jest.mocked(supabase.auth.onAuthStateChange).mock.calls[0]![0];
    listener('SIGNED_OUT', null);

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
