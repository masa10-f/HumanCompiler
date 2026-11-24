// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Signed URLs for the images notes refer to.
 *
 * A note holds only attachment ids. The images are private, so the API hands
 * out URLs that expire after a few minutes, for the owner only. This resolver
 * asks for the ids of all images that appear together in one request, keeps
 * the answers until shortly before they expire, and asks again after that.
 */

import type { NoteAttachmentUrlsResponse } from '@/types/context-note';

export interface ResolvedAttachment {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export type FetchAttachmentUrls = (ids: string[]) => Promise<NoteAttachmentUrlsResponse>;

// Images that mount in the same moment share one request.
const BATCH_DELAY_MS = 20;
// The API answers at most this many ids per request.
const BATCH_SIZE = 100;
// A URL this close to its expiry is not handed out any more.
const EXPIRY_MARGIN_MS = 60_000;
// How long "not yours, or deleted" is remembered before asking again.
const MISSING_TTL_MS = 30_000;

interface CacheEntry {
  value: ResolvedAttachment | null;
  /** Epoch ms after which the entry is asked for again. */
  until: number;
}

interface Waiter {
  resolve: (value: ResolvedAttachment | null) => void;
  reject: (error: unknown) => void;
}

export class AttachmentUrlResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly waiting = new Map<string, Waiter[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Raised by clear(): an answer asked for before it is not kept.
  private generation = 0;

  constructor(
    private readonly fetchUrls: FetchAttachmentUrls,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * The URLs of an attachment, or null if it is not the user's or is gone.
   * `fresh` skips the cache: use it when a URL just failed to load.
   */
  resolve(id: string, { fresh = false }: { fresh?: boolean } = {}): Promise<ResolvedAttachment | null> {
    const key = id.toLowerCase();
    if (!fresh) {
      const cached = this.cache.get(key);
      if (cached && cached.until > this.now()) return Promise.resolve(cached.value);
    }
    return new Promise((resolve, reject) => {
      const waiters = this.waiting.get(key) ?? [];
      waiters.push({ resolve, reject });
      this.waiting.set(key, waiters);
      if (this.timer === null) {
        this.timer = setTimeout(() => {
          void this.flush();
        }, BATCH_DELAY_MS);
      }
    });
  }

  /**
   * Forget every URL. Called when the signed-in user changes: a URL opens
   * its image for anyone who has it, so one user's URLs must not be handed
   * to the next user of the same tab. Answers still on their way are given
   * to those who asked and then dropped.
   */
  clear(): void {
    this.generation += 1;
    this.cache.clear();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const generation = this.generation;
    const batch = new Map(this.waiting);
    this.waiting.clear();
    const ids = [...batch.keys()];
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const chunk = ids.slice(start, start + BATCH_SIZE);
      try {
        const response = await this.fetchUrls(chunk);
        const expiresAt = Date.parse(response.expires_at);
        const until = Number.isNaN(expiresAt)
          ? this.now()
          : expiresAt - EXPIRY_MARGIN_MS;
        const found = new Map(response.items.map((item) => [item.id.toLowerCase(), item]));
        for (const id of chunk) {
          const item = found.get(id);
          const value = item
            ? {
                url: item.url,
                thumbUrl: item.thumb_url,
                width: item.width,
                height: item.height,
              }
            : null;
          if (generation === this.generation) {
            this.cache.set(id, {
              value,
              until: value ? until : this.now() + MISSING_TTL_MS,
            });
          }
          batch.get(id)?.forEach((waiter) => waiter.resolve(value));
        }
      } catch (error) {
        for (const id of chunk) {
          batch.get(id)?.forEach((waiter) => waiter.reject(error));
        }
      }
    }
  }
}
