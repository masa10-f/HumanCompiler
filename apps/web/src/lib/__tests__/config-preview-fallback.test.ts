/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://human-compiler-git-feature-team.vercel.app/projects/1"}
 */
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { appConfig, getApiEndpoint, getFallbackApiEndpoint } from '../config'

describe('API endpoints on a preview deployment', () => {
  it('uses the preview API without a production fallback', () => {
    expect(getApiEndpoint()).toBe(appConfig.api.endpoints.preview)
    expect(getFallbackApiEndpoint()).toBe('')
  })
})
