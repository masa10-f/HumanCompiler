// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

// Document-local identities must also work on non-TLS self-hosted origins.
export function createDailyPlanId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `block-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
