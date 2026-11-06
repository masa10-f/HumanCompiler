// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { workTypeLabels } from '@/types/task';

type TextControl = 'text' | 'textarea' | 'number' | 'date';
type Control = TextControl | 'work_type' | 'priority';

export interface FieldSpec {
  label: string;
  control: Control;
  rows?: number;
}

export const FIELD_SPECS: Record<string, FieldSpec> = {
  title: { label: 'タイトル', control: 'text' },
  description: { label: '説明', control: 'textarea' },
  estimate_hours: { label: '見積もり時間（時間）', control: 'number' },
  estimated_hours: { label: '見積もり時間（時間）', control: 'number' },
  due_date: { label: '期限', control: 'date' },
  work_type: { label: '作業種別', control: 'work_type' },
  priority: { label: '優先度', control: 'priority' },
  note_markdown: { label: 'ノート（Markdown）', control: 'textarea', rows: 12 },
  content_markdown: { label: '内容', control: 'textarea', rows: 12 },
  question: { label: '確かめること', control: 'textarea' },
  method: { label: '方法', control: 'textarea' },
  supports_if: { label: '肯定の条件', control: 'textarea' },
  refutes_if: { label: '否定の条件', control: 'textarea' },
  effort: { label: '手間', control: 'text' },
  prerequisites: { label: '前提', control: 'textarea' },
};

// Radix Select cannot hold an empty item value, so "unset" gets a placeholder value.
export const UNSET = '__unset__';
export const PRIORITIES = ['1', '2', '3', '4', '5'] as const;

interface OptionSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  allowUnset?: boolean;
  disabled: boolean;
}

export function OptionSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  allowUnset,
  disabled,
}: OptionSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === UNSET ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowUnset ? <SelectItem value={UNSET}>指定なし</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FormField({
  label,
  required,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor={htmlFor}
        className={required ? "after:ml-0.5 after:text-destructive after:content-['*']" : undefined}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}


interface FieldControlProps {
  id: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

/** The input for one text-like payload field, chosen by its spec. */
export function FieldControl({ id, field, value, onChange, disabled }: FieldControlProps) {
  const spec = FIELD_SPECS[field];
  if (!spec) return null;
  switch (spec.control) {
    case 'textarea':
      return (
        <Textarea
          id={id}
          rows={spec.rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'work_type':
      return (
        <OptionSelect
          id={id}
          value={value}
          onChange={onChange}
          options={Object.entries(workTypeLabels).map(([v, label]) => ({ value: v, label }))}
          allowUnset
          disabled={disabled}
        />
      );
    case 'priority':
      return (
        <OptionSelect
          id={id}
          value={value}
          onChange={onChange}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          allowUnset
          disabled={disabled}
        />
      );
    default:
      return (
        <Input
          id={id}
          type={spec.control}
          step={spec.control === 'number' ? '0.25' : undefined}
          min={spec.control === 'number' ? '0' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }
}
