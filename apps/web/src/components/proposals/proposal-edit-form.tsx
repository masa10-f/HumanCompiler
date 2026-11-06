// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useGoalsByProject } from '@/hooks/use-goals-query';
import { useProjectOptions } from '@/hooks/use-project-query';
import {
  buildEditedPayload,
  EDITABLE_FIELDS,
  GOAL_TASK_REQUIRED_FIELDS,
  initialFormValues,
  initialTaskItems,
  isEditableKind,
  REQUIRED_FIELDS,
  type EditableProposalKind,
  type FormValues,
  type TaskItemState,
} from '@/lib/proposal-edit';
import type { Proposal, ProposalAcceptRequest } from '@/types/proposal';
import { GoalTaskItemsEditor } from './goal-task-items-editor';
import { FIELD_SPECS, FieldControl, FormField, OptionSelect } from './proposal-field-control';
import { noteTarget } from './proposal-payload-view';
import { useProposalDecision } from './use-proposal-decision';

const EXPERIMENT_NOTE_LABEL = '実行するエージェントへの追加の指示（任意）';
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
  const [initialTasks] = useState<TaskItemState[]>(() =>
    kind === 'goal' ? initialTaskItems(original) : []
  );
  const [taskItems, setTaskItems] = useState<TaskItemState[]>(initialTasks);

  const projects = useProjectOptions({ enabled: kind === 'goal' || kind === 'task' });
  const goals = useGoalsByProject(kind === 'task' ? projectId : '');

  const set = (field: string, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const canSubmit =
    REQUIRED_FIELDS[kind].every((f) => (values[f] ?? '').trim() !== '') &&
    taskItems.every(
      (item) =>
        item.removed ||
        GOAL_TASK_REQUIRED_FIELDS.every((f) => (item.values[f] ?? '').trim() !== '')
    );
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

    const edited = buildEditedPayload(
      kind,
      original,
      initial,
      values,
      kind === 'goal' ? { initial: initialTasks, current: taskItems } : undefined
    );
    const body: ProposalAcceptRequest = edited ? { payload: edited } : {};
    if (kind === 'experiment' && note.trim() !== '') body.decision_note = note.trim();
    accept(body);
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
            <FieldControl
              id={`${fieldId}-${field}`}
              field={field}
              value={values[field] ?? ''}
              onChange={(v) => set(field, v)}
              disabled={busy}
            />
          </FormField>
        );
      })}
      {kind === 'goal' && taskItems.length > 0 ? (
        <GoalTaskItemsEditor items={taskItems} onChange={setTaskItems} disabled={busy} />
      ) : null}
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
