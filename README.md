# dsh-pet-panel

A **dual-face plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI: a browser half (pet, session dashboard, and three self-service capability panels) plus a host half (skill / MCP / A2A gateways, model-facing A2A tools, and an inbound A2A endpoint), with per-profile data isolation.

## Features

### Browser (client)

- **Desktop pet** (`PetView`) — a global floating pet above every column, independent of the active session. Draggable, skinnable (five SVG species with eye/mouth emotes), resizable, persisted to `localStorage`. Reacts to session lifecycle (running → busy, pending → waiting, finishing → celebration) plus manual feed/play/sleep controls. Toggle it from the chat with `/pet on` / `/pet off` / `/pet`.
- **Session dashboard** (`DashboardView`) — a conversation-view tab (会话仪表盘 / Dashboard) showing live context occupancy, session totals, a 7-day activity trend, token-spend ranking, and detailed context analysis of the active session. Renders derived data only.
- **Skill Forge** (技能工坊) — list / read / write / delete `SKILL.md` files, and generate a new skill from a natural-language description via the default model.
- **Tool Integrations** (工具集成) — list / add / edit / delete MCP servers (stdio or streamable-http).
- **A2A Management** (A2A 管理) — configure this plugin's own Agent Card and register external A2A agents (name / URL / description / capabilities / keywords), with the generated agent-card URL and message/send endpoint shown for copy.
- **Task manager** — a session-header entry plus overlay panel surfacing the current session's full execution trace (turn → step → tool-call → approval → todo).
- **Background switcher** — four Papergames official wallpapers with a brightness/dim control, persisted to `localStorage`.

### Host (Node service)

- `SkillForgeGateway`, `ToolIntegrationsGateway`, `A2AConfigGateway` — Typert remotes backing the three panels above.
- A2A **outbound** tools — `a2a_list_agents` / `a2a_call` let the model discover and call registered external A2A agents.
- A2A **inbound** endpoint — serves `/.well-known/agent-card.json` and a JSON-RPC `message/send` handler at `/a2a`, so other agents can call this plugin's card.
- **Per-profile isolation** — skills, MCP config, and A2A config all resolve to the active profile (`~/.dsh/profiles/<name>/`), so each profile sees only its own skills and tools.

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

The first install builds `lib/index.js` + `lib/client.js` from source via the `prepare` script (no type checking — that's what CI does).

## Development

Keep this repo and DeepSeek Harness as siblings so the type gate can resolve the harness checkout:

```text
../
├── deepseek-harness   # your DeepSeek Harness checkout
└── dsh-pet-panel      # this repo
```

```sh
pnpm install
pnpm run build      # tsc -b && tsdown && postbuild — emits lib/index.js + lib/client.js + types
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

The host half exposes its services as Typert remotes: `src/client/remote.ts` holds the hand-written `TYPERT_REMOTE` manifest describing each method's wire codec, and the client mounts the namespaces onto the Typert client remote.

## License

MIT
