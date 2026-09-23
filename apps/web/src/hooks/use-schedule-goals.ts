// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { useCallback, useEffect, useState } from "react";
import { goalsApi } from "@/lib/api";
import type { Goal } from "@/types/goal";

/** Load goals independently of tasks, only when scheduling suggestions need them. */
export function useScheduleGoals(projectIds: string[], enabled: boolean) {
  const projectKey = JSON.stringify([...projectIds].sort());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const pending: string[] = JSON.parse(projectKey);
    setLoading(true);
    setError(false);
    setGoals([]);
    const load = async () => {
      const loaded: Goal[] = [];
      let failed = false;
      // Bound concurrent requests, and include every page for each project.
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (pending.length && !cancelled) {
            const projectId = pending.shift()!;
            try {
              let skip = 0;
              while (!cancelled) {
                const page = await goalsApi.getByProject(projectId, skip, 100);
                loaded.push(...page);
                if (page.length < 100) break;
                skip += page.length;
              }
            } catch {
              failed = true;
            }
          }
        }),
      );
      if (cancelled) return;
      setGoals(
        loaded
          .filter(
            (goal) =>
              goal.status !== "completed" && goal.status !== "cancelled",
          )
          .sort(
            (a, b) =>
              a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
          ),
      );
      setError(failed);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectKey, enabled, attempt]);

  return { goals, loading, error, retry };
}
