---
type: concept
title: Dual-Face Plugin Architecture
description: The top-level mental model for how dsh-pet-panel mounts into a DeepSeek Harness web profile as a Node host face (six cordis Gateways in src/index.ts exposing Typert remotes) plus a browser client face (src/client/index.ts slot components consuming them), wired together by the package.json bundle patch and the hand-written TYPERT_REMOTE manifest.
tags: [dual-face, plugin, typert-remote, cordis-plugin, web-profile, per-profile-isolation, skill-forge, tool-integrations, a2a, mcp, dsh-plugin, slot-components]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-03T02:25:20.569Z
sources:
  - id: openwiki-source-ac8a116de08a43024fbe345d
    resource: repo://cordis.patch.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a692df6049a59ddd8480d952
    resource: repo://src/client/brand.tsx
  - id: openwiki-source-3503e2677e2cb13a4c324b90
    resource: repo://src/client/index.ts
  - id: openwiki-source-13fa458a8e66fcc21d4b8230
    resource: repo://src/client/petStore.ts
  - id: openwiki-source-9574f44db93f6ce7d70675b2
    resource: repo://src/client/remote.ts
  - id: openwiki-source-0cf4a536b1ef488c94cb2f36
    resource: repo://src/client/taskStore.ts
  - id: openwiki-source-b319c6b1dce15a46c1bb9ee2
    resource: repo://src/client/theme.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "openwiki/0.5.0", at: "2026-09-03T02:25:20.569Z" }
---

# Dual-Face Plugin Architecture

dsh-pet-panel is a single npm package that deliberately mounts into a DeepSeek Harness **web profile** as **two faces**. They are separate concerns, built into separate bundles, loaded by separate runtimes, and communicate only through an explicit RPC contract. This page is the top-level map: how the package announces itself to the harness, what the host half does, what the client half does, and how the two halves speak.

The host and browser faces are the two halves of one `src/` tree. The **host face** is the Node service bundle loaded by the dsh host process; the **browser face** is the closure-factory bundle served to the browser. Each half must stay in its own directory so the dual-face split survives every build.

```mermaid
flowchart TD
    pkg["dsh-pet-panel npm package"]
    cfg["package.json dsh.bundle.patch + dsh.client"]
    host["Host face: lib/index.js from src/index.ts (Node)"]
    client["Browser face: lib/client.js from src/client/index.ts (browser)"]
    patch["cordis.patch.yml inserts pet-panel row into web roster"]
    slots["client applies slot components into shell slot maps"]
    gateways["six cordis Gateways: ProfileSkills / SkillForge / ToolIntegrations / A2AConfig / A2ATools / A2AInbound"]
    remote["hand-written TYPERT_REMOTE manifest w/ zod codecs"]
    rt["client mounts namespaces onto ctx.remote via $mount"]
    rpc["client calls remote: ctx.remote.skillForge.list() etc."]
    pkg --> cfg
    cfg --> patch
    patch --> host
    patch --> client
    host --> gateways
    gateways -->|"@Remote methods"| remote
    client --> slots
    client --> rt
    rt --> remote
    rt --> rpc
    rpc -->|"ok/value or ok/error envelope"| slots
```

Caption: The two faces, their packaging wiring, and the Typert RPC bridge that connects the client slot components to the host Gateways.

## The two halves at a glance

| Face | Source | Emitted bundle | Runtime | Responsibility |
| --- | --- | --- | --- | --- |
| **Host** | `src/index.ts` | `lib/index.js` | Node (dsh host) | Cordis services: Gateways, model tools, inbound A2A endpoint, per-profile skill provider. Default `"."` export. |
| **Client** | `src/client/index.ts` | `lib/client.js` | Browser (web module loader) | Slot components: dashboard, pet, brand/theme, capability panels, `/pet` command. `"./client"` export. |

`package.json` maps the two bundles through `exports`: `"."` → `lib/index.js` + `lib/types/index.d.ts`, `"./client"` → `lib/client.js` + `lib/types/client/index.d.ts`, plus `"./src/*"` and `"./package.json"` passthroughs; `files` ships `lib/**/*.js`, `lib/**/*.d.ts`, `src`, and `cordis.patch.yml` (`package.json#L28-L48`).

## Packaging contract: announcing the plugin to the harness

Two fields in `package.json` are the entire mount contract. `dsh.bundle.patch` points at `cordis.patch.yml`, and `dsh.client` describes how the web module table should scan this package (`package.json#L50-L67`).

- **`dsh.bundle.patch` → `cordis.patch.yml`** — an insert-only patch that adds the `pet-panel` row to the web profile's plugin roster. Installing the package (`dsh plugin --profile web add github:zw11591-sketch/dsh-pet-panel`) applies the layer automatically. The row is the single entry point for both halves: the modules Node half scans the `dsh.client` packages into the web plugin roster (which is what makes `lib/client.js` get served), and the host half registers the skill / MCP / A2A gateways plus the A2A inbound endpoint. (`cordis.patch.yml#L1-L10`.)
- **`dsh.client`** (`platform: "web"`, `inject: ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"]`) — makes the web module table scan this package into the browser roster and serve `lib/client.js`. The entries are the shell faces the client face expects to coexist with (locale, runtime, conversation views, layout/shell overlay, sidebar brand slots).

The client build is produced by `build/tsdown.client.ts`'s `clientBundle(...)` preset, wrapped in `window.__ModuleLoader__.load({ id, factory })` so `@deepseek-ai/*` and `react` resolve from the shell's frozen module table; `zod` (the wire schema) inlines into the client bundle. The build chain, module table, and postbuild decorator lowering are documented separately in [Build, Bundling, and Packaging](/openwiki/architecture/build-and-packaging.md).

## Host face: six cordis plugins in `apply()`

`src/index.ts` exports a single `apply(ctx)` that registers exactly six plugins (`src/index.ts#L1078-L1085`):

1. **`ProfileSkillProviderPlugin`** — registers a `FileSystemSkillProvider` scoped to the current profile's `skills/` dir, with `includeDefaultRoots: false`, so only that profile's skills load (`src/index.ts#L1062-L1076`). It reuses dsh's YAML-frontmatter parsing and `isSkillName` validation.
2. **`SkillForgeGateway`** — a `TypertRemoteService` exposing `list` / `read` / `write` / `delete` / `generate` / `lifecycle` over `@Remote(...)` methods. `generate` drives `llm.stream` with the current default model; `lifecycle` decompresses the per session `session.jsonl.zstd` frame-by-frame and folds it into a flat event list (`src/index.ts#L159-L410`).
3. **`ToolIntegrationsGateway`** — a `TypertRemoteService` exposing `list` / `read` / `write` / `delete` for MCP servers, hot-mounting them through `ctx.loader.create`/`remove` (`src/index.ts#L431-L535`).
4. **`A2AConfigGateway`** — a `TypertRemoteService` exposing `get` / `setCard` / `upsertAgent` / `delete` for the A2A card and external-agent list (`src/index.ts#L638-L704`).
5. **`A2AToolsPlugin`** — a cordis `Service` (injecting `tools`) that registers the model-facing `a2a_list_agents` / `a2a_call` tools (`src/index.ts#L812-L914`).
6. **`A2AInboundPlugin`** — a `Service` (injecting `webServer`, `llm`, `agentDefaultModel`) that serves `/.well-known/agent-card.json` and a JSON-RPC `message/send` handler at the `/a2a` prefix, replying through `llm.stream` (`src/index.ts#L939-L1055`).

### Per-profile isolation

Every host data surface resolves to the **active profile directory**, not to a process-relative path. dsh does not `chdir` to the profile directory and does not expose it to plugins, but `--profile <name>` is always present in `process.argv`. `profileNameFromArgv` parses that flag, and `skillRoot()`, `MCP_FILE()`, and `a2aConfigDir()` all build `$DSH_HOME/profiles/<profile>/...` from it (`src/index.ts#L23-L26`, `#L414-L417`, `#L571-L598`). This is why `dsh --profile <name>` from any cwd and `cd <profile> && dsh` both land on the same config — the paths are deterministic, not cwd-dependent.

Guest-facing path inputs are validated to prevent traversal: skill names must match `^[A-Za-z0-9_-]{1,64}$` (`assertName`, `src/index.ts#L14-L21`), session ids must match `^session-[A-Za-z0-9-]+$` (`src/index.ts#L306-L308`).

## The Typert remote bridge

The host/client boundary is an explicit RPC contract, not shared imports. The host Gateways are `TypertRemoteService` subclasses whose public methods carry `@Remote('method')` decorators; the identity of each method is discovered from the `typertRemote` binding plus the `@Remote` markers in **source mode**, so no generated `/typert` artifact is needed. Each method returns a JSON-safe business value; the framework wraps it into `{ ok: true, value } | { ok: false, error }`.

The client side only needs a hand-written manifest. `src/client/remote.ts` defines `TYPERT_REMOTE` with `package`, `descriptors`, and per-method **wire codecs**: JSON-encoded position parameters and a strict result schema, each with `typeSymbol`s like `dsh-pet-panel#skillForge/list:result` (`src/client/remote.ts#L100-L159`). The result schema describes the method's business return value, which is what lets the client unwrap the boundary envelope.

The bridge is wired in `src/client/index.ts`:

```ts
const disposeRemote = await (ctx as any).remote.$mount(TYPERT_REMOTE)
```

The client calls a mounted namespace through `ctx.remote.<ns>.<method>()` and unwraps the envelope with a local `unwrap()` helper that throws `r.error.message` when `r.ok` is false (`src/client/index.ts#L36-L40`, `#L182-L183`). The three namespaces — `skillForge`, `toolIntegrations`, `a2aConfig` — are mounted onto the Typert client remote. Because `compact()` strips `undefined` own-properties from results before returning (`src/index.ts#L147-L157`), zod `.optional()` fields can't leave a `undefined` property that makes Typert's `assertJsonValue` throw `"undefined is not JSON-safe"` and surface as a bogus "business result failed boundary validation".

## Client face: slot components and the capability child plugin

`src/client/index.ts` applies a brand/theme overlay, a per-session dashboard and floating pet, and three self-service capability panels. Its `inject` is `['slots', 'locale', 'remote']` (`src/client/index.ts#L34`). The browser face registers into the shell's slot maps:

| Slot row | Component | Purpose |
| --- | --- | --- |
| `conversation.view` (order 20) | `DashboardView` | Session dashboard tab. |
| `shell.overlay` | `PetView` | Global floating pet, docked to the shell overlay. |
| `sidebar.brand.mark` / `sidebar.brand.name` (priority −1) | `PapergamesLogo` / `PapergamesWordmark` | Papergames brand shadowing the official DeepSeek whale. |
| `conversation.hero.brand.mark` (priority −1) | `PapergamesLogo` | Hero brand mark swap. |
| `sidebar.footer.action` (order 10) | `BackgroundSwitcher` | Wallpaper + dim switcher. |
| `conversation.session.header.actions` (order 20) | `TaskManagerTrigger` | Session-header "Tasks" entry. |
| `conversation.view` (order 30/40/50) | `SkillForgeView`, `ToolIntegrationsView`, `A2AView` | Capability panels, each injecting its `api`. |
| `shell.overlay` (order 100) | `TaskManagerView` | Task manager overlay with lifecycle trace. |

The base views (dashboard, pet, brand swap, background) register directly in `apply()`. The three capability panels do **not**. They live in a child plugin `pet-panel-capabilities` whose `inject` is `['slots', 'locale', 'remote', 'remote.skillForge', 'remote.toolIntegrations', 'remote.a2aConfig']` (`src/client/index.ts#L221-L228`). This is a deliberate ordering constraint: the main `apply(ctx)` only holds `remote`, so touching `remote.skillForge` there would throw `without inject`; the namespaces resolve only against the now-mounted services inside the child plugin (`src/client/index.ts#L147-L157`). Each capability view is injected with an `api` object built by wrapping the corresponding `ctx.remote.<ns>` calls in `unwrap()`.

The `/pet on | off | toggle` command is similarly isolated in a `pet-panel-command` child plugin injecting `['inputTriggers', 'sessions']`. It registers an input-trigger source on `/` (registered after the built-in command source, so it wins by first-non-undefined adjudication), matches `/pet`, toggles the pet, returns `'handled'` so the line is consumed rather than sent to the model, and clears the input box via the `slash/input-consume-token` bail event (`src/client/index.ts#L42-L96`).

### Shared state across slots

The `PetView` (shell overlay) and the `/pet` command interceptor live in different slots and cannot share React context, so the pet visibility state lives in a module-level publish/subscribe store, `petStore.ts`, exposing a stable `getSnapshot`/`subscribe` surface for `useSyncExternalStore` (`src/client/petStore.ts#L1-L47`). The task manager uses the same pattern with `taskPanelStore.ts` to bridge `TaskManagerTrigger` and `TaskManagerView`.

### Brand, theme, and hero copy

Because the shell's brand slots are `single` at default priority 0, the Papergames occupants register at `priority: -1` (lowest wins) to shadow the official whale — there is no host theme machinery to touch (`src/client/brand.tsx#L1-L63`). The Papergames theme repaints the DeepSeek blue token ramp onto a coral ramp by injecting a `<style>` on `body` (the host installs tokens on `body`, not `:root`, so a `:root` override would lose to the descendant `body` rule) (`src/client/theme.ts#L21-L57`). The tab favicon is replaced and the empty-state hero slogan is rewritten with a `MutationObserver`, because the locale `register` throws `already has locale` for an existing namespace+locale and cannot be legitimately overridden (`src/client/brand.tsx#L94-L120`). Background and dim restores read from `localStorage`, defaulting to a Papergames wallpaper at 0.25 dim.

## Host-side A2A: outbound tools and inbound endpoint

A2A is wired in both directions. **Outbound** — `A2AToolsPlugin` registers `a2a_list_agents` and `a2a_call` so the model can discover and call registered external agents. `a2a_call` resolves the agent name by exact → normalized → substring → Levenshtein distance (only a unique hit is used), and when resolution fails it returns a candidate-closure message naming the registered agents so the model can retry in a later tool call rather than erroring (`src/index.ts#L762-L904`). **Inbound** — `A2AInboundPlugin` serves the discovery card at `/.well-known/agent-card.json` and a JSON-RPC `message/send` handler under the `/a2a` prefix, reading the request body, extracting the message text, and replying as this plugin's own agent via `llm.stream` with a system prompt built from the configured card (`src/index.ts#L918-L1054`). The `/a2a` prefix deliberately avoids the SPA's `/` fallback.

## Related pages

- [Build, Bundling, and Packaging](/openwiki/architecture/build-and-packaging.md) — the `tsc -b && tsdown && postbuild` chain, the closure-factory client preset, the frozen module table, and why postbuild copies tsc-lowered output over the rolldown host bundle.
- Per-profile isolation is the shared substrate for the Skill Forge, Tool Integrations, and A2A host surfaces.
- The Typert remote bridge is the contract consumed on the client side by `src/client/remote.ts` and the three capability views.
