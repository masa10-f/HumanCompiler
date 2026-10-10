// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle, ChevronRight, Clock, Play, type LucideIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { StatusGroup, StatusGroupKey } from '@/lib/status-groups'

const GROUP_ICONS: Record<StatusGroupKey, { icon: LucideIcon; className: string }> = {
  in_progress: { icon: Play, className: 'text-primary' },
  pending: { icon: Clock, className: 'text-muted-foreground' },
  closed: { icon: CheckCircle, className: 'text-success' },
}

type HeadingTag = 'h2' | 'h3'

function readStoredOpen(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? null : value === 'true'
  } catch {
    return null
  }
}

function writeStoredOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, String(open))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the
    // section still works, it just won't remember the choice.
  }
}

function GroupLabel({ group }: { group: StatusGroup<unknown> }) {
  const { icon: Icon, className } = GROUP_ICONS[group.key]
  return (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', className)} aria-hidden="true" />
      <span>{group.label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {group.items.length}
      </span>
    </>
  )
}

const headingClassName =
  'flex items-center gap-2 text-sm font-semibold text-foreground'

function CollapsibleGroupSection({
  group,
  headingAs: Heading,
  storageKey,
  defaultOpen,
  children,
}: {
  group: StatusGroup<unknown>
  headingAs: HeadingTag
  storageKey: string
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  // Read after mount so server and first client render agree. Without a
  // stored choice, follow `defaultOpen` both ways: open when this becomes the
  // only group left (so cards don't vanish behind it) and collapse again once
  // open work comes back.
  useEffect(() => {
    const stored = readStoredOpen(storageKey)
    setOpen(stored ?? defaultOpen)
  }, [defaultOpen, storageKey])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    writeStoredOpen(storageKey, next)
  }

  return (
    <Collapsible asChild open={open} onOpenChange={handleOpenChange}>
      <section>
        <Heading className={headingClassName}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-90',
                )}
                aria-hidden="true"
              />
              <GroupLabel group={group} />
            </button>
          </CollapsibleTrigger>
        </Heading>
        <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}

interface StatusGroupedListProps<T extends { id: string }> {
  groups: StatusGroup<T>[]
  renderItem: (item: T) => ReactNode
  /** Layout classes for the items inside each group (e.g. a card grid). */
  itemsClassName?: string
  /** Distinguishes lists when remembering whether the closed group is open. */
  storageKey: string
  headingAs?: HeadingTag
}

/**
 * Renders items under 進行中 / 未着手 / 完了・キャンセル headings. The closed
 * group is collapsed by default (unless nothing else is left) and remembers
 * the user's choice per list.
 */
export function StatusGroupedList<T extends { id: string }>({
  groups,
  renderItem,
  itemsClassName,
  storageKey,
  headingAs = 'h3',
}: StatusGroupedListProps<T>) {
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  const hasOpenWork = visibleGroups.some((group) => group.key !== 'closed')
  const Heading = headingAs

  return (
    <div className="space-y-8">
      {visibleGroups.map((group) => {
        const items = (
          <div className={itemsClassName}>
            {group.items.map((item) => (
              <Fragment key={item.id}>{renderItem(item)}</Fragment>
            ))}
          </div>
        )

        if (group.key === 'closed') {
          return (
            <CollapsibleGroupSection
              key={group.key}
              group={group}
              headingAs={headingAs}
              storageKey={`humancompiler:status-groups:${storageKey}:closed-open`}
              defaultOpen={!hasOpenWork}
            >
              {items}
            </CollapsibleGroupSection>
          )
        }

        return (
          <section key={group.key} className="space-y-4">
            <Heading className={headingClassName}>
              <GroupLabel group={group} />
            </Heading>
            {items}
          </section>
        )
      })}
    </div>
  )
}
