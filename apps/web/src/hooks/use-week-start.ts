// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { useQuery } from '@tanstack/react-query';
import { weekStartApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** The weekday the user's weeks start on (settings page 週の始まり). */
export function useWeekStartSettings({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.userSettings.weekStart(),
    queryFn: () => weekStartApi.get(),
    enabled,
  });
}
