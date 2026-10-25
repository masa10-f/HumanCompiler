// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

export interface AgentToken {
  id: string;
  name: string;
  description: string | null;
  scopes: string[];
  token_prefix: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTokenCreate {
  name: string;
  description?: string;
  scopes: string[];
}

export interface AgentTokenCreated extends AgentToken {
  token: string;
}

export interface AgentScopeInfo {
  scope: string;
  description: string;
  broad: boolean;
}

export interface AgentTokenPreset {
  key: string;
  label: string;
  description: string;
  scopes: string[];
}

export interface AgentScopeCatalog {
  scopes: AgentScopeInfo[];
  presets: AgentTokenPreset[];
}

export interface AgentAuditLog {
  id: string;
  token_id: string | null;
  token_prefix: string | null;
  method: string;
  route: string;
  required_scope: string | null;
  status_code: number;
  duration_ms: number;
  client_ip: string | null;
  created_at: string;
}
