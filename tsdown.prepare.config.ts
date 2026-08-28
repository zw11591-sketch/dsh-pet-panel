import { clientBundle } from './build/tsdown.client.ts'

/**
 * Consumer-side build for git installs (the `prepare` script): transpile
 * straight from src without tsc project references, which need a sibling
 * harness checkout that only dev machines and CI have. Types are NOT checked
 * here — `pnpm run typecheck` owns that. The client bundle is emitted too:
 * the modules node half serves lib/client.js to browsers, so a git-installed
 * package must ship it.
 */
export default clientBundle('dsh-pet-panel', ['src/index.ts'])
