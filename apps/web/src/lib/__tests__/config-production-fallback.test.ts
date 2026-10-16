/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://human-compiler.rityo-lab.com/projects/1"}
 */
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { appConfig, getApiEndpoint, getFallbackApiEndpoint } from '../config'

describe('API endpoints on the production custom domain', () => {
  it('uses the production API for both primary and fallback', () => {
    expect(getApiEndpoint()).toBe(appConfig.api.endpoints.production)
    expect(getFallbackApiEndpoint()).toBe(appConfig.api.endpoints.production)
  })
})
