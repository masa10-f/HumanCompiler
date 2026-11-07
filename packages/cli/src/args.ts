// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/** Small helpers shared by the subcommands' option parsing. */

import { CliError } from './api'

export function numberOption(
  name: string,
  raw: string | undefined,
  min: number,
  max: number,
  { integer = false } = {},
): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (
    raw.trim() === '' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    const kind = integer ? 'a whole number' : 'a number'
    throw new CliError(`--${name} must be ${kind} from ${min} to ${max}`)
  }
  return value
}

/**
 * `parseArgs` handles `--no-...` options (allowNegative) from Node 22.4.0,
 * backported to 20.16.0. Node 21.x and 22.0-22.3 do not have it.
 */
export const SUPPORTED_NODE = '20.16+ or 22.4+'

export function nodeVersionOk(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return (major === 20 && minor >= 16) || (major === 22 && minor >= 4) || major >= 23
}

export function checkNodeVersion(version = process.versions.node): void {
  if (!nodeVersionOk(version)) {
    throw new CliError(`Node.js ${SUPPORTED_NODE} is required (this is ${version})`)
  }
}

/** A usage error: exit code 2 and the subcommand's help. */
export function usageError(message: string, help: string): CliError {
  return new CliError(`${message}\n\n${help}`, 2)
}
