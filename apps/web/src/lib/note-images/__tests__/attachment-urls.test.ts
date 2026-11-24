// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { AttachmentUrlResolver } from '../attachment-urls';
import type { NoteAttachmentUrlsResponse } from '@/types/context-note';

const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-8888-4777-8666-555555555555';
const START = Date.parse('2026-11-24T00:00:00Z');
const TEN_MINUTES = 10 * 60 * 1000;

function setup() {
  let now = START;
  let version = 0;
  const known = new Set([A]);
  const fetchUrls = jest.fn(async (ids: string[]): Promise<NoteAttachmentUrlsResponse> => {
    version += 1;
    return {
      items: ids
        .filter((id) => known.has(id))
        .map((id) => ({
          id,
          url: `https://storage.test/${id}/preview.webp?v=${version}`,
          thumb_url: `https://storage.test/${id}/thumb.webp?v=${version}`,
          width: 1600,
          height: 1000,
          caption: '図1',
        })),
      expires_at: new Date(now + TEN_MINUTES).toISOString(),
    };
  });
  const resolver = new AttachmentUrlResolver(fetchUrls, () => now);
  const resolve = async (id: string, options?: { fresh?: boolean }) => {
    const pending = resolver.resolve(id, options);
    await jest.advanceTimersByTimeAsync(25);
    return pending;
  };
  return {
    fetchUrls,
    resolver,
    resolve,
    known,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('AttachmentUrlResolver', () => {
  it('asks for the images of one render in a single request', async () => {
    const { fetchUrls, resolver } = setup();

    const pending = Promise.all([resolver.resolve(A), resolver.resolve(B), resolver.resolve(A)]);
    await jest.advanceTimersByTimeAsync(25);
    const [first, missing, again] = await pending;

    expect(fetchUrls).toHaveBeenCalledTimes(1);
    expect(fetchUrls).toHaveBeenCalledWith([A, B]);
    expect(first).toEqual({
      url: `https://storage.test/${A}/preview.webp?v=1`,
      thumbUrl: `https://storage.test/${A}/thumb.webp?v=1`,
      width: 1600,
      height: 1000,
    });
    expect(again).toEqual(first);
    // Not the user's, or deleted: the API leaves it out.
    expect(missing).toBeNull();
  });

  it('keeps a URL until shortly before it expires', async () => {
    const { fetchUrls, resolve, advance } = setup();
    const first = await resolve(A);

    advance(TEN_MINUTES - 2 * 60 * 1000);
    expect(await resolve(A)).toEqual(first);
    expect(fetchUrls).toHaveBeenCalledTimes(1);

    // One minute before expiry the URL is no longer handed out.
    advance(61 * 1000);
    const renewed = await resolve(A);
    expect(fetchUrls).toHaveBeenCalledTimes(2);
    expect(renewed?.url).toBe(`https://storage.test/${A}/preview.webp?v=2`);
  });

  it('asks again when a URL just failed to load', async () => {
    const { fetchUrls, resolve } = setup();
    await resolve(A);

    const renewed = await resolve(A, { fresh: true });

    expect(fetchUrls).toHaveBeenCalledTimes(2);
    expect(renewed?.thumbUrl).toBe(`https://storage.test/${A}/thumb.webp?v=2`);
  });

  it('remembers a missing image only briefly', async () => {
    const { fetchUrls, resolve, advance, known } = setup();
    expect(await resolve(B)).toBeNull();
    expect(await resolve(B)).toBeNull();
    expect(fetchUrls).toHaveBeenCalledTimes(1);

    // e.g. the upload finished in the meantime
    known.add(B);
    advance(31 * 1000);

    expect(await resolve(B)).not.toBeNull();
  });

  it('treats ids as the same whatever their case', async () => {
    const { fetchUrls, resolve } = setup();
    await resolve(A);

    expect(await resolve(A.toUpperCase())).not.toBeNull();
    expect(fetchUrls).toHaveBeenCalledTimes(1);
  });

  it('splits a long note into requests the API accepts', async () => {
    const { fetchUrls, resolver } = setup();
    const ids = Array.from({ length: 150 }, (_, index) =>
      `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
    );

    const pending = Promise.all(ids.map((id) => resolver.resolve(id)));
    await jest.advanceTimersByTimeAsync(25);
    await pending;

    expect(fetchUrls.mock.calls.map(([chunk]) => chunk.length)).toEqual([100, 50]);
  });

  it('reports a failed request and tries again next time', async () => {
    const { fetchUrls, resolver, resolve } = setup();
    fetchUrls.mockRejectedValueOnce(new Error('offline'));

    const pending = resolver.resolve(A);
    const failed = expect(pending).rejects.toThrow('offline');
    await jest.advanceTimersByTimeAsync(25);
    await failed;

    expect(await resolve(A)).not.toBeNull();
  });

  it('does not keep an answer that arrives after clear', async () => {
    const { fetchUrls, resolver, resolve } = setup();
    let answer: (response: NoteAttachmentUrlsResponse) => void = () => {};
    fetchUrls.mockImplementationOnce(
      () => new Promise<NoteAttachmentUrlsResponse>((done) => (answer = done))
    );
    const pending = resolver.resolve(A);
    await jest.advanceTimersByTimeAsync(25);

    // The user signs out while the request is on its way.
    resolver.clear();
    answer({
      items: [
        {
          id: A,
          url: 'https://storage.test/previous-user/preview.webp',
          thumb_url: 'https://storage.test/previous-user/thumb.webp',
          width: 10,
          height: 10,
          caption: '',
        },
      ],
      expires_at: new Date(START + TEN_MINUTES).toISOString(),
    });
    expect((await pending)?.url).toContain('previous-user');

    // The next user is asked for again, not served the earlier answer.
    const next = await resolve(A);
    expect(fetchUrls).toHaveBeenCalledTimes(2);
    expect(next?.url).not.toContain('previous-user');
  });

  it('forgets everything on clear', async () => {
    const { fetchUrls, resolver, resolve } = setup();
    await resolve(A);

    resolver.clear();
    await resolve(A);

    expect(fetchUrls).toHaveBeenCalledTimes(2);
  });
});
