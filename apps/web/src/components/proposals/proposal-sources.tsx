// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { sourceHref } from '@/lib/proposal-links';
import type { ProposalSource } from '@/types/proposal';

/** Evidence the agent cited. Only http(s) refs become links. */
export function ProposalSources({ sources }: { sources: ProposalSource[] }) {
  if (sources.length === 0) return null;

  return (
    <ul className="space-y-2 text-sm">
      {sources.map((source, index) => {
        const href = sourceHref(source.ref);
        // The label is agent text and may not match the target, so a link
        // always shows where it really goes.
        const host = href ? new URL(href).hostname : null;
        const linkText = source.label ? `${source.label} (${host})` : host;
        return (
          <li key={`${index}-${source.ref}`} className="min-w-0">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words text-primary underline underline-offset-2"
              >
                {linkText}
              </a>
            ) : (
              <>
                {source.label ? (
                  <span className="mr-2 whitespace-pre-wrap break-words">{source.label}</span>
                ) : null}
                <code className="break-all font-mono text-xs">{source.ref}</code>
              </>
            )}
            {source.quote ? (
              <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 pl-3 text-muted-foreground">
                {source.quote}
              </blockquote>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
