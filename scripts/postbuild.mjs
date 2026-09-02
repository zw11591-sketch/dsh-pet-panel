/**
 * Fix the host-half bundle emitted by tsdown/rolldown.
 *
 * rolldown does not lower Stage-3 decorators (@Remote from dsh-typert-protocol),
 * so `lib/index.js` keeps `@Remote("...")` tokens verbatim and Node's ESM loader
 * throws "SyntaxError: Invalid or unexpected token" when dsh loads the host face.
 *
 * tsc DOES lower them (to __esDecorate). The `tsc -b` step already emits a
 * correct ESM host bundle at lib/types/index.js — same `export function apply`
 * surface — so we simply copy it over the rolldown output.
 */

import { copyFileSync } from 'node:fs'

const src = 'lib/types/index.js'
const dst = 'lib/index.js'

copyFileSync(src, dst)
console.log(`[postbuild] host: ${src} -> ${dst} (decorators lowered by tsc)`)
