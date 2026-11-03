// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { useGoalsByProject } from '@/hooks/use-goals-query';
import { useProjectOptions } from '@/hooks/use-project-query';
import {
  buildEditedPayload,
  EDITABLE_FIELDS,
  initialFormValues,
  isEditableKind,
  REQUIRED_FIELDS,
  type EditableProposalKind,
  type FormValues,
} from '@/lib/proposal-edit';
import { workTypeLabels } from '@/types/task';
import type { Proposal, ProposalAcceptRequest } from '@/types/proposal';
import { noteTarget } from './proposal-payload-view';
import { useProposalDecision } from './use-proposal-decision';

type TextControl = 'text' | 'textarea' | 'number' | 'date';
type Control = TextControl | 'work_type' | 'priority';

interface FieldSpec {
  label: string;
  control: Control;
  rows?: number;
}

const FIELD_SPECS: Record<string, FieldSpec> = {
  title: { label: 'タイトル', control: 'text' },
  description: { label: '説明', control: 'textarea' },
  estimate_hours: { label: '見積もり時間（時間）', control: 'number' },
  estimated_hours: { label: '見積もり時間（時間）', control: 'number' },
  due_date: { label: '期限', control: 'date' },
  work_type: { label: '作業種別', control: 'work_type' },
  priority: { label: '優先度', control: 'priority' },
  content_markdown: { label: '内容', control: 'textarea', rows: 12 },
  question: { label: '確かめること', control: 'textarea' },
  method: { label: '方法', control: 'textarea' },
  supports_if: { label: '肯定の条件', control: 'textarea' },
  refutes_if: { label: '否定の条件', control: 'textarea' },
  effort: { label: '手間', control: 'text' },
  prerequisites: { label: '前提', control: 'textarea' },
};

const EXPERIMENT_NOTE_LABEL = '実行するエージェントへの追加の指示（任意）';
// Radix Select cannot hold an empty item value, so "unset" gets a placeholder value.
const UNSET = '__unset__';
const PRIORITIES = ['1', '2', '3', '4', '5'] as const;

interface OptionSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  allowUnset?: boolean;
  disabled: boolean;
}

function OptionSelect({
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

function FormField({
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

interface EditFieldsProps {
  proposal: Proposal;
  kind: EditableProposalKind;
  onCancel: () => void;
}

function EditFields({ proposal, kind, onCancel }: EditFieldsProps) {
  const { accept, busy, error } = useProposalDecision(proposal);
  const fieldId = useId();
  const original = proposal.final_payload ?? proposal.payload;
  const [initial] = useState(() => initialFormValues(kind, original));
  const [values, setValues] = useState<FormValues>(initial);
  // The task's project only narrows the goal choices; it is not in the payload.
  const [projectId, setProjectId] = useState(proposal.project_id ?? '');
  const [note, setNote] = useState('');

  const projects = useProjectOptions({ enabled: kind === 'goal' || kind === 'task' });
  const goals = useGoalsByProject(kind === 'task' ? projectId : '');

  const set = (field: string, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const canSubmit = REQUIRED_FIELDS[kind].every((f) => (values[f] ?? '').trim() !== '');
  const projectOptions = (projects.data ?? []).map((p) => ({ value: p.id, label: p.title }));
  const goalOptions = (goals.data ?? []).map((g) => ({ value: g.id, label: g.title }));

  function handleProjectChange(next: string) {
    if (next === projectId) return;
    setProjectId(next);
    set('goal_id', '');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;

    const edited = buildEditedPayload(kind, original, initial, values);
    const body: ProposalAcceptRequest = edited ? { payload: edited } : {};
    if (kind === 'experiment' && note.trim() !== '') body.decision_note = note.trim();
    accept(body);
  }

  function renderControl(field: string, spec: FieldSpec) {
    const id = `${fieldId}-${field}`;
    const value = values[field] ?? '';
    switch (spec.control) {
      case 'textarea':
        return (
          <Textarea
            id={id}
            rows={spec.rows}
            value={value}
            onChange={(e) => set(field, e.target.value)}
            disabled={busy}
          />
        );
      case 'work_type':
        return (
          <OptionSelect
            id={id}
            value={value}
            onChange={(v) => set(field, v)}
            options={Object.entries(workTypeLabels).map(([v, label]) => ({ value: v, label }))}
            allowUnset
            disabled={busy}
          />
        );
      case 'priority':
        return (
          <OptionSelect
            id={id}
            value={value}
            onChange={(v) => set(field, v)}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
            allowUnset
            disabled={busy}
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
            onChange={(e) => set(field, e.target.value)}
            disabled={busy}
          />
        );
    }
  }

  const target = kind === 'note_append' ? noteTarget(proposal, original) : null;

  return (
    <form noValidate onSubmit={handleSubmit} className="w-full space-y-4">
      {target ? (
        <p className="whitespace-pre-wrap break-words text-sm">
          <span className="text-muted-foreground">{`追記先（${target.label}）: `}</span>
          {target.name}
        </p>
      ) : null}
      {kind === 'task' ? (
        <FormField label="プロジェクト" htmlFor={`${fieldId}-project`}>
          <OptionSelect
            id={`${fieldId}-project`}
            value={projectId}
            onChange={handleProjectChange}
            options={projectOptions}
            disabled={busy}
          />
        </FormField>
      ) : null}
      {EDITABLE_FIELDS[kind].map((field) => {
        const required = REQUIRED_FIELDS[kind].includes(field);
        if (field === 'project_id' || field === 'goal_id') {
          const isProject = field === 'project_id';
          return (
            <FormField
              key={field}
              label={isProject ? 'プロジェクト' : 'Goal'}
              required={required}
              htmlFor={`${fieldId}-${field}`}
            >
              <OptionSelect
                id={`${fieldId}-${field}`}
                value={values[field] ?? ''}
                onChange={(v) => set(field, v)}
                options={isProject ? projectOptions : goalOptions}
                disabled={busy}
              />
            </FormField>
          );
        }
        const spec = FIELD_SPECS[field];
        if (!spec) return null;
        return (
          <FormField
            key={field}
            label={spec.label}
            required={required}
            htmlFor={`${fieldId}-${field}`}
          >
            {renderControl(field, spec)}
          </FormField>
        );
      })}
      {kind === 'experiment' ? (
        <FormField label={EXPERIMENT_NOTE_LABEL} htmlFor={`${fieldId}-note`}>
          <Textarea
            id={`${fieldId}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </FormField>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !canSubmit}>
          この内容で承認
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap break-words">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

interface ProposalEditFormProps {
  proposal: Proposal;
  onCancel: () => void;
}

/** Edit a pending proposal's payload, then accept it with the changes. */
export function ProposalEditForm({ proposal, onCancel }: ProposalEditFormProps) {
  if (!isEditableKind(proposal.kind)) return null;
  return <EditFields proposal={proposal} kind={proposal.kind} onCancel={onCancel} />;
}
