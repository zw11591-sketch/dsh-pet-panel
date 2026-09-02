import { clientBundle } from './build/tsdown.client.ts'

// Dual-face client plugin: the node-half lib build (host Gateways exposing the
// skillForge / toolIntegrations Typert remotes) plus the browser client bundle.
// The host half's @deepseek-ai runtime deps resolve from the dsh profile tree,
// so they stay external (same stance as cordis). The client half is emitted
// from src/client/index.ts and wrapped so the web runtime loads it through
// window.__ModuleLoader__.load with @deepseek-ai/* resolved from the module
// table; zod (the wire schema) inlines into the client bundle.
export default clientBundle('dsh-pet-panel', ['src/index.ts'], {
  // Stage-3 decorators (@Remote) must be lowered or Node's ESM loader throws
  // "Invalid or unexpected token"; es2022 target forces rolldown to emit the
  // __esDecorate helpers instead of leaving the decorator syntax in the ESM.
  lib: { target: 'es2015' },
  libExternal: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-skill-filesystem',
  ],
})
