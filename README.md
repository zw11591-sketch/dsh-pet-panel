# dsh-pet-panel

A **dual-face plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI: a browser half (desktop pet, session dashboard, and four self-service capability panels) plus a host half (skill / MCP / A2A / team gateways, model-facing A2A tools, and an inbound A2A endpoint), with per-profile data isolation.

## Features

### Browser (client)

- **Desktop pet** (`PetView`) — a global floating pet above every column, independent of the active session. Draggable, skinnable (five SVG species with eye/mouth emotes), resizable, persisted to `localStorage`. Reacts to session lifecycle (running → busy, pending → waiting, finishing → celebration) plus manual feed/play/sleep controls. Toggle it from the chat with `/pet on` / `/pet off` / `/pet`.
- **Session dashboard** (`DashboardView`) — a conversation-view tab (会话仪表盘 / Dashboard) with two sections: **概览** (live context occupancy, session totals, 7-day activity trend, archived/forked session lists) and **用量分析** (token-spend ranking, detailed context analysis of the active session). Renders derived data only.
- **Skill Forge** (技能工坊) — list / read / write / delete `SKILL.md` files, and generate a new skill from a natural-language description via the default model.
- **Tool Integrations** (工具集成) — list / add / edit / delete MCP servers (stdio or streamable-http).
- **A2A Management** (A2A 管理) — configure this plugin's own Agent Card, register external A2A agents (name / URL / description / capabilities / keywords / examples), show live online/offline/latency status per registered agent, and show the generated agent-card URL and `message/send` endpoint for copy.
- **Team** (团队) — create teams from yourself ("me") plus registered external A2A agents; group chat and 1:1 chat with @mention routing (`@name` directed, `@all` broadcast, no `@` = broadcast), multi-turn memory via per-agent A2A contextId, live member online/offline status, and a "对方回复中" typing indicator while waiting for a reply.
- **Background switcher** — four Papergames official wallpapers with a brightness/dim control, persisted to `localStorage`.

### Host (Node service)

- `SkillForgeGateway`, `ToolIntegrationsGateway`, `A2AConfigGateway`, `TeamGateway` — Typert remotes backing the panels above.
- A2A **outbound** tools — `a2a_list_agents` / `a2a_call` let the model discover and call registered external A2A agents.
- A2A **inbound** endpoint — serves `/.well-known/agent-card.json` and a JSON-RPC `message/send` handler at `/a2a`, driving the *same* agent runtime as the WebUI (identical model, tools, skills, MCP, and multi-turn memory via `contextId` ↔ `sessionId`).
- **Per-profile isolation** — skills, MCP config, A2A config, and teams all resolve to the active profile (`~/.dsh/profiles/<name>/`), so each profile sees only its own skills, tools, and teams.

## Requirements

- **Node.js** `^22.19.0 || >=24.0.0` (see `package.json` `engines`).
- **pnpm** on your PATH — `dsh plugin` is a thin forwarder that spawns `pnpm` inside the profile directory, so `pnpm not found` is a hard blocker.
- **DeepSeek Harness** `>=0.1.1-rc.1` (see `package.json` `dsh.engines`).

## Install

### From a git repository (recommended for consumers)

```sh
dsh plugin --profile <name> add github:zw11591-sketch/dsh-pet-panel
```

> `--profile` is **required** — a bare `dsh plugin add ...` errors with
> `required option '--profile <name>' not specified`.

This is a git-source install, so pnpm ≥ 10 blocks the `prepare` build step until you allow it. pnpm prints the exact package key to copy. For the **first** install the key is just the package name — add it to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-pet-panel: true
```

Then re-run the `add` command. The first install builds `lib/index.js` + `lib/client.js` from source via the `prepare` script (no type checking — that is what CI does).

Finally start the profile:

```sh
dsh --profile <name>
```

### From a local checkout (`file:`)

```sh
cd dsh-pet-panel
pnpm install
pnpm run build
dsh plugin --profile <name> add file:.
dsh --profile <name>
```

> `file:` installs are **copy-not-symlink on Windows**: rebuilding the checkout
> does NOT propagate into the profile. See "Rebuild done but the change isn't visible" below.

## Update

### git-source installs

**Pitfall: `pnpm update` will NOT fetch a new commit.** A `github:user/repo` spec only re-fetches when the spec string changes (no version bump → no re-fetch). To actually pull a new commit, use one of:

```sh
# A. remove + re-add (simplest, deterministic)
dsh plugin --profile <name> remove dsh-pet-panel
dsh plugin --profile <name> add github:zw11591-sketch/dsh-pet-panel

# B. pin a specific ref, then update
dsh plugin --profile <name> add "github:zw11591-sketch/dsh-pet-panel#<branch-or-commit>"

# C. break the semver range and go newest (only relevant for npm-published plugins)
dsh plugin --profile <name> update --latest dsh-pet-panel
```

After a git re-add, pnpm will again block the new commit's `prepare` build until you allow it. **The `allowBuilds` key is commit-specific** — update `pnpm-workspace.yaml` to the exact key pnpm prints:

```yaml
allowBuilds:
  dsh-pet-panel@https://codeload.github.com/zw11591-sketch/dsh-pet-panel/tar.gz/<NEW-COMMIT>: true
```

Drop the stale `<old-commit>` entries, then re-run the `add`.

### `file:` installs

Re-run the add (triggers re-copy + `prepare`), or copy the build output directly:

```sh
cp -rf /path/to/dsh-pet-panel/lib/. ~/.dsh/profiles/<name>/node_modules/dsh-pet-panel/lib/
```

Then restart the profile (see "Rebuild done but the change isn't visible" for the full restart + verify loop).

## Uninstall / remove

```sh
dsh plugin --profile <name> remove dsh-pet-panel
```

This is equivalent to `pnpm remove` inside the profile directory: it deletes the dependency entry, uninstalls from `node_modules`, and a post-run reconcile step prunes the plugin from `dsh.profile.bundles`. Restart the profile; it now boots without the plugin.

> Do **not** hand-edit `dsh.profile.bundles` in `package.json` — `dsh plugin add/remove`
> keeps it correct automatically.

## Troubleshooting

### 1. `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

pnpm ≥ 10 refuses to run the `prepare` build for a git dependency until its key is allow-listed. The message shows `tar.gz/<COMMIT>` — that means pnpm *did* resolve to the right commit; it just won't build.

**Fix:** copy the exact key pnpm printed into `~/.dsh/profiles/<name>/pnpm-workspace.yaml` under `allowBuilds`, drop stale entries, re-run the `add`.

### 2. `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`

"project has no dependencies of any kind". The profile's `package.json` has no `dependencies` field, so `pnpm remove` has nothing to delete — the plugin survives only as `node_modules` + lockfile residue (a desync state, typically from a prior hand-edit or an aborted operation).

**Fix:** skip the `remove` entirely and `add` directly — it re-declares the dependency and overwrites `node_modules`.

### 3. `ERR_PNPM_IGNORED_BUILDS` pointing at the OLD commit

The package actually downloaded, built ("Build complete"), and linked — but pnpm also reports the *old* commit as an ignored build (stale `node_modules/.modules.yaml` → `ignoredBuilds`), exits non-zero, so dsh's reconcile step never runs and `bundles` is not updated.

**Fix:** run a plain install, which recomputes `ignoredBuilds` (clears to `[]`) and lets reconcile append the plugin to `bundles`:

```sh
dsh plugin --profile <name> install
```

Verify afterwards: `ignoredBuilds` is `[]` in `.modules.yaml`, the lockfile has only the new commit, and `bundles` lists `dsh-pet-panel`.

### 4. `pnpm not found on PATH` (exit 127)

`dsh plugin` forwards to pnpm. Install pnpm first (`npm i -g pnpm` or `corepack enable`), then re-run.

### 5. Rebuild done but the change isn't visible (stale bundle / wrong profile)

Symptom: you edit source, `pnpm run build` exits 0, but the running web UI still shows the old behaviour. Do **not** assume the logic is wrong — 90% of the time the server is serving a stale bundle, or you patched a profile that isn't the one on the port. Diagnose in this order:

1. **Find which profile owns the port.** The UI URL (e.g. `:8801`) does not tell you the profile name.

   ```sh
   netstat -ano | grep ':8801' | grep LISTEN          # -> PID
   wmic process where processid=<PID> get CommandLine   # -> --profile <name> --port <n>
   ```

   A `--profile pet-test --port 8801` on the process means every edit must land in `pet-test`, not `web` — even if the user calls it "the web page".

2. **Confirm the profile's copy is stale** (the host reads from the profile's `node_modules`, not your checkout):

   ```sh
   grep -c "<a-new-marker-string>" ~/.dsh/profiles/<name>/node_modules/dsh-pet-panel/lib/client.js
   # 0 = stale; >0 = current
   ```

3. **Copy + restart:**

   ```sh
   cp -rf /path/to/dsh-pet-panel/lib/. ~/.dsh/profiles/<name>/node_modules/dsh-pet-panel/lib/
   taskkill /F /PID <pid>
   cd ~/.dsh/profiles/<name> && dsh --profile <name> --port <n>
   ```

   (`taskkill` needs single-slash `/F` on MSYS/Git-Bash — `//F` is not recognized.)

4. **Verify the served bytes, not just the file on disk.** The web app serves the client bundle at `/plugins/??<comma-joined list>&rev=<hash>` — the list is read from the page's `<script src>`; a bare `/plugins/??dsh-pet-panel/client.js` returns **404**. Fetch the full URL and grep for a marker, and hard-refresh (`Ctrl+Shift+R`) in the browser to clear the cached bundle.

### 6. `EADDRINUSE` after a restart

`dsh --profile <p> --no-open` run in the background forks a child process; killing the parent leaves the child holding the port. Find the leftover listener and kill it:

```sh
netstat -ano | grep ':<port>' | grep LISTEN
taskkill /F /PID <pid>
```

### 7. `ERR_MODULE_NOT_FOUND: Cannot find package 'lightningcss'` (developers only)

This fires during `pnpm install` (the `prepare` build) when building from source without `lightningcss`. It is already a devDependency of this repo, so it only bites if you are porting the build tooling — add `lightningcss` to devDependencies.

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
dsh plugin --profile <name> add file:.
dsh --profile <name>
```

## How it works

The package declares two manifests in `package.json`:

- `dsh.bundle.patch` → `cordis.patch.yml`, which inserts the plugin row into the profile. Installing the package applies the patch layer automatically.
- `dsh.client` (`platform: web`, `inject: [...]`) → the web module table scans this package into the browser roster and serves `lib/client.js`.

The client bundle is built by `build/tsdown.client.ts` — a self-contained port of DeepSeek Harness's own client-bundle preset. It wraps the plugin in `window.__ModuleLoader__.load({ id, factory })`, compiles CSS Modules through lightningcss, and resolves `@deepseek-ai/*` + `react` through the shell's frozen module table (no globals, no import map).

The host half exposes its services as Typert remotes: `src/client/remote.ts` holds the hand-written `TYPERT_REMOTE` manifest describing each method's wire codec (`skillForge`, `toolIntegrations`, `a2aConfig`, `team`), and the client mounts the namespaces onto the Typert client remote.

The inbound A2A endpoint (`/a2a`) drives the real agent loop via `ctx.agents.create` / `resume` + `followup` + `whenIdle`, so it shares the WebUI's model, tools, skills, and MCP. Because there is no interactive approval channel over A2A, approval is set to a fail-closed `never` policy: tools that would require approval are deterministically rejected, and the response carries a `metadata.approvalsBlocked` array (tool + reason) instead of failing silently.

## Documentation

Project docs are auto-generated by [OpenWiki](https://github.com/langchain-ai/openwiki) into `openwiki/` (plus the `AGENTS.md` / `CLAUDE.md` entry snippets). A scheduled GitHub Action (`.github/workflows/openwiki-update.yml`) keeps them in sync on a cron and opens a PR on each update; it reads `OPENAI_COMPATIBLE_API_KEY` / `OPENWIKI_LANGSMITH_API_KEY` from repo secrets, so set those before enabling the workflow.

## License

MIT
