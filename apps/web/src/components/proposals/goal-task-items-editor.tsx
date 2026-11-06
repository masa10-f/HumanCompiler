// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  GOAL_TASK_FIELDS,
  GOAL_TASK_REQUIRED_FIELDS,
  type TaskItemState,
} from '@/lib/proposal-edit';
import { FIELD_SPECS, FieldControl, FormField } from './proposal-field-control';

interface GoalTaskItemsEditorProps {
  items: TaskItemState[];
  onChange: (next: TaskItemState[]) => void;
  disabled: boolean;
}

/** Edit the tasks of a goal proposal, or take individual tasks out of it. */
export function GoalTaskItemsEditor({ items, onChange, disabled }: GoalTaskItemsEditorProps) {
  const baseId = useId();
  // The first render holds the untouched titles, used when a removed task's title is blank.
  const [originalTitles] = useState(() => items.map((item) => item.values.title ?? ''));

  const update = (index: number, patch: Partial<TaskItemState>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const setField = (index: number, field: string, value: string) => {
    const item = items[index];
    if (item) update(index, { values: { ...item.values, [field]: value } });
  };

  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        if (item.removed) {
          const title = item.values.title?.trim() || originalTitles[index] || '';
          return (
            <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="whitespace-pre-wrap break-words text-muted-foreground">
                {`外す: ${title}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => update(index, { removed: false })}
              >
                元に戻す
              </Button>
            </div>
          );
        }
        return (
          <fieldset key={index} className="space-y-4 rounded-md border p-4">
            <legend className="px-1 text-sm font-medium">{`Task ${index + 1}`}</legend>
            {GOAL_TASK_FIELDS.map((field) => {
              const id = `${baseId}-${index}-${field}`;
              return (
                <FormField
                  key={field}
                  label={FIELD_SPECS[field]?.label ?? field}
                  required={GOAL_TASK_REQUIRED_FIELDS.includes(field)}
                  htmlFor={id}
                >
                  <FieldControl
                    id={id}
                    field={field}
                    value={item.values[field] ?? ''}
                    onChange={(v) => setField(index, field, v)}
                    disabled={disabled}
                  />
                </FormField>
              );
            })}
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => update(index, { removed: true })}
            >
              この Task を外す
            </Button>
          </fieldset>
        );
      })}
    </div>
  );
}
