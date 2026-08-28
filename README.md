# dsh-pet-panel

A self-contained **client plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It contributes two independent surfaces, both riding the slot service's effect wrapper so plugin unload removes them:

- **Desktop pet** (`PetView`) — a global floating pet above every column, independent of the active session. Draggable, skinnable (five SVG species with eye/mouth emotes), resizable, persisted to `localStorage`. Reacts to session lifecycle (running → busy, pending → waiting, finishing → celebration) plus manual feed/play/sleep controls.
- **Hello panel** (`HelloView`) — a conversation-view tab (你好面板 / Hello) showing live context occupancy, session totals, a 7-day activity trend, token-spend ranking, and detailed context analysis of the active session. Renders derived data only; no service, no store.

It has no host-side service and no model experience: it registers no tool, no prompt section, no context message, and no Remote method.

## Install

```sh
dsh plugin --profile web add github:zw11591-sketch/dsh-pet-panel
```

This is a git-source install, so pnpm ≥10 blocks the `prepare` build until you allow it. Copy the exact package key pnpm prints into the profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-pet-panel: true
```

Then start:

```sh
dsh --profile web
```

The first install builds `lib/client.js` from source via the `prepare` script (no type checking — that's what CI does).

## Development

Keep this repo and DeepSeek Harness as siblings so the type gate can resolve the harness checkout:

```text
../
├── deepseek-harness   # your DeepSeek Harness checkout
└── dsh-pet-panel      # this repo
```

```sh
pnpm install
pnpm run build      # tsc -b && tsdown — emits lib/index.js + lib/client.js + types
pnpm run typecheck  # the type gate (needs the sibling harness checkout)
```

From a local checkout, build and install a `file:` package:

```sh
pnpm run build
dsh plugin --profile web add file:.
dsh --profile web
```

## How it works

The package declares two manifests in `package.json`:

- `dsh.bundle.patch` → `cordis.patch.yml`, which inserts the plugin row into the web profile. Installing the package applies the patch layer automatically.
- `dsh.client` (`platform: web`, `inject: [...]`) → the web module table scans this package into the browser roster and serves `lib/client.js`.

The client bundle is built by `build/tsdown.client.ts` — a self-contained port of DeepSeek Harness's own client-bundle preset. It wraps the plugin in `window.__ModuleLoader__.load({ id, factory })`, compiles CSS Modules through lightningcss, and resolves `@deepseek-ai/*` + `react` through the shell's frozen module table (no globals, no import map).

## License

MIT
