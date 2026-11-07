// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Bundles the CLI with the web app's roadmap code (apps/web/src, through the
// "@/..." alias in tsconfig.json), so the image is drawn by the same code as
// the timeline page. Also copies the two font weights the drawing uses and
// the licences into the package.

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(path.join(root, 'package.json'))
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

rmSync(path.join(root, 'dist'), { recursive: true, force: true })
await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: path.join(root, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Applies this tsconfig (paths, jsx) to the web app's files too.
  tsconfig: path.join(root, 'tsconfig.json'),
  jsx: 'automatic',
  // The native rasterizer is installed as a dependency, not bundled.
  external: ['@resvg/resvg-js'],
  define: {
    'process.env.NODE_ENV': '"production"',
    __VERSION__: JSON.stringify(version),
  },
  banner: { js: '#!/usr/bin/env node' },
  // The web modules carry 'use client', which means nothing here.
  logOverride: { 'module-level-directive': 'silent' },
  legalComments: 'linked',
  logLevel: 'warning',
})

const fontPackage = path.dirname(require.resolve('@expo-google-fonts/noto-sans-jp/package.json'))
const fonts = path.join(root, 'fonts')
rmSync(fonts, { recursive: true, force: true })
mkdirSync(fonts)
for (const [dir, file] of [
  ['400Regular', 'NotoSansJP_400Regular.ttf'],
  ['700Bold', 'NotoSansJP_700Bold.ttf'],
]) {
  copyFileSync(path.join(fontPackage, dir, file), path.join(fonts, file))
}
copyFileSync(path.join(fontPackage, 'LICENSE_FONT'), path.join(fonts, 'OFL.txt'))
copyFileSync(path.join(root, '../../LICENSE-AGPL-3.0'), path.join(root, 'LICENSE'))
