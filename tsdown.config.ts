import { clientBundle } from './build/tsdown.client.ts'

// Single self-contained client plugin: the node-half lib build (empty host
// `apply`) plus the browser client bundle. The client half is emitted from
// src/client/index.ts and wrapped so the web runtime loads it through
// window.__ModuleLoader__.load with @deepseek-ai/* resolved from the module
// table.
export default clientBundle('dsh-hello-plugin', ['src/index.ts'])
