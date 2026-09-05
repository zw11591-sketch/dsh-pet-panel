---
type: integration-reference
title: DeepSeek Harness Contract Surface
description: The exact external contract dsh-pet-panel consumes and plugs into — the dsh package manifest fields (dsh.engines.dsh, dsh.bundle.patch, dsh.client), the cordis services each face injects, the SlotMap rows it registers against, the @deepseek-ai/* modules resolved from the harness tree, the frozen browser module table, and the peer runtime requirements.
tags: [harness-contract, cordis-services, slot-map, dsh-manifest, external-modules, frozen-module-table, peer-requirements, dsh-plugin, integration-surface]
sources:
  - id: openwiki-source-cdd83677ebacfc37110cded7
    resource: repo://build/tsdown.client.ts
  - id: openwiki-source-6236ebea5721787442907153
    resource: repo://build/web-platform.ts
  - id: openwiki-source-ac8a116de08a43024fbe345d
    resource: repo://cordis.patch.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-3503e2677e2cb13a4c324b90
    resource: repo://src/client/index.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-40f53d1663f704797c52ff86
    resource: repo://tsdown.config.ts
generated: { by: "openwiki/0.5.0", at: "2026-09-04T14:14:38.291Z" }
verified:
  - by: openwiki/0.5.0
    at: 2026-09-04T14:14:38.291Z
---

# DeepSeek Harness Contract Surface

dsh-pet-panel is a **dual-face** plugin for the DeepSeek Harness Web UI. Everything the plugin *depends on* from outside its own `src/` tree — the announcements in `package.json`, the cordis services each face injects, the shell slot rows it registers into, the `@deepseek-ai/*` modules that resolve from the harness tree, the frozen browser module table, and the peer runtime floor — is the **harness contract**. This page enumerates that contract so a harness upgrade or API change can be reasoned about at a glance. It deliberately does not describe the plugin's internals (see [Dual-Face Plugin Architecture](/openwiki/architecture/overview.md)); it describes only the surface the plugin relies on.

The authoritative inputs are `package.json`, `cordis.patch.yml`, `src/index.ts`, `src/client/index.ts`, and the build configs; the installed `@deepseek-ai/*` packages under `node_modules` (resolved from the sibling harness checkout) are the ground truth for the contract's shapes. Because this contract lives outside the repo, it must be re-verified against the harness checkout whenever the harness changes — the `pnpm run typecheck` gate is what catches a drifted interface.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    manifest["package.json dsh manifest"]
    engines["dsh.engines.dsh >=0.1.1-rc.1"]
    patch["dsh.bundle.patch to cordis.patch.yml"]
    clientField["dsh.client platform web + inject 5 client faces"]
    patchRow["pet-panel row inserted into web plugin roster"]
    host["Host face lib/index.js from src/index.ts"]
    clientFace["Browser face lib/client.js from src/client/index.ts"]
    hostSvcs["injects llm, agentDefaultModel, loader, tools, webServer, agents, sessions, skills"]
    clientSvcs["injects slots, locale, remote, remote.ns, inputTriggers, sessions"]
    slotRows["SlotMap rows and ordering"]
    manifest --> engines
    manifest --> patch
    manifest --> clientField
    patch --> patchRow
    patchRow --> host
    patchRow --> clientFace
    host --> hostSvcs
    clientFace --> clientSvcs
    clientFace --> slotRows
```

Caption: The external contract surfaces: how the `dsh` manifest announces the plugin to the harness and wires both faces, the cordis services each face injects, and the slot rows the client registers into.

## The `dsh` package manifest contract

Three fields in `package.json#dsh` are the entire mount-announcement contract (`package.json#L50-L67`).

- **`dsh.engines.dsh`** — the minimum harness version this package is compatible with. It is currently `">=0.1.1-rc.1"` (`package.json#L50-L53`). This is the **compatibility floor**: a breaking change to any contract surface below (a renamed cordis service, a dropped slot row, a removed module) should be caught by raising this floor so the harness rejects the package at install/type time.
- **`dsh.bundle.patch`** — `"./cordis.patch.yml"` (`package.json#L54-L56`). An insert-only layer the harness applies when the package is installed into a profile.
- **`dsh.client`** — declares **`platform: "web"`** and an **`inject`** list of five client shell faces (`package.json#L57-L66`). This makes the web module table scan the package into the browser roster and serve `lib/client.js`.

### The bundle patch (`cordis.patch.yml`)

`dsh.bundle.patch` points at `cordis.patch.yml`, which **inserts the `pet-panel` row** into the web profile's plugin roster (`cordis.patch.yml#L8-L10`). The row is the single mount entry for both halves:

- the **modules Node half** scans the `dsh.client` packages into the web plugin roster, which is what serves `lib/client.js` to browsers; and
- the **host half** (`src/index.ts`) registers the skill / MCP / A2A / team gateways and the A2A inbound endpoint.

Installing the package (e.g. `dsh plugin --profile web add github:zw11591-sketch/dsh-pet-panel`) applies this layer automatically, so the row needs no manual wiring.

## Injected cordis services

Both faces are cordis plugins and declare their consumed services through `static inject`. Each is a **harness-provided service**: if the harness renames or removes one, the corresponding face fails at load. These are the full set the plugin relies on.

### Host face (`src/index.ts`)

The host face's seven plugins (registered in `apply()`, `src/index.ts#L1465-L1473`) inject:

| Plugin | `static inject` | Services consumed |
| --- | --- | --- |
| `SkillForgeGateway` | `['llm', 'agentDefaultModel']` | `llm.stream` / `llm.listProviders` / `llm.listModels` for skill generation; `agentDefaultModel.currentSelection()` for the default provider/model. `src/index.ts#L59` |
| `ToolIntegrationsGateway` | `['loader']` | `loader.create` / `loader.remove` to hot-mount and tear down MCP server entries. `src/index.ts#L223` |
| `A2AConfigGateway` | none | Pure file-backed config; no harness service. `src/index.ts#L429` |
| `A2AToolsPlugin` | `['tools']` | `tools.register(defineTool(...))` for the model-facing A2A tools. `src/index.ts#L748` |
| `A2AInboundPlugin` | `['webServer', 'agents', 'sessions', 'agentDefaultModel']` | `webServer.register({kind, path, handler})` for the agent-card and `/a2a` endpoints; `agents.resume` / `agents.create` + `sessions.flush` to run the real agent loop; `agentDefaultModel.currentSelection()` for the model. `src/index.ts#L896` |
| `ProfileSkillProviderPlugin` | `['skills']` | `skills.registerProvider(...)` to register a per-profile `FileSystemSkillProvider`. `src/index.ts#L1450` |
| `TeamGateway` | `['llm', 'agentDefaultModel']` | `agentDefaultModel.currentSelection()` + `llm.stream` for the "me" self-reply path in team threads; the team/thread persistence is otherwise file-backed. `src/index.ts#L1196` |

The three host data surfaces (`skillRoot()`, `MCP_FILE()`, `a2aConfigDir()`) resolve to the active profile's directory under `$DSH_HOME/profiles/<name>/` rather than to `process.cwd()`, parsed from the `--profile` flag in `process.argv` (`src/index.ts#L22-L25`, `#L205-L208`, `#L362-L385`). This is the contract's **per-profile isolation** behavior, documented in [Per-Profile Isolation](/openwiki/concepts/per-profile-isolation.md).

### Client face (`src/client/index.ts`)

The client face injects its services hierarchically across three cordis plugins:

- **Main `apply(ctx)`** injects `['slots', 'locale', 'remote']` (`src/client/index.ts#L33-L34`). It mounts the hand-written Typert remote manifest via `ctx.remote.$mount(TYPERT_REMOTE)` (`src/client/index.ts#L192-L193`), which attaches the `skillForge` / `toolIntegrations` / `a2aConfig` / `team` namespaces onto the Typert client remote.
- **`pet-panel-capabilities`** child plugin injects `['slots', 'locale', 'remote', 'remote.skillForge', 'remote.toolIntegrations', 'remote.a2aConfig', 'remote.team']` (`src/client/index.ts#L232-L237`). The `remote.<ns>` entries resolve only against the *already-mounted* namespace services, which is why the capability views must run in a child plugin rather than in the main `apply(ctx)` (whose ctx only holds `remote`).
- **`pet-panel-command`** child plugin injects `['inputTriggers', 'sessions']` (`src/client/index.ts#L240-L246`) to register the `/pet` slash-command input source and to consume the input via the `slash/input-consume-token` bail event through `ctx.sessions.scope(...)`.

Contract notes: `ctx.locale.register(NS, { zh, en })` and `ctx.locale.bind(NS)` supply the client's `t` translator; `ctx.slots.inject(slot, () => ctx.slots.register({...}, Component))` adds components to the shell's slot maps.

## SlotMap rows the client registers against

The client contributes components into six shell **SlotMap rows** (declared by the harness's `dsh-client-ui-*` packages through `declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap }`). Each registration relies on the shell's slot semantics: a `list` row renders its entries by **ascending `order`**, and a `single` row resolves by **lowest `priority`** (so a `priority: -1` occupant shadows an official one at default `0`).

| Slot row (kind) | Component | `order` / `priority` | Purpose |
| --- | --- | --- | --- |
| `conversation.view` (list) | `DashboardView` | order 20 | Session dashboard tab. `src/client/index.ts#L196-L202` |
| `conversation.view` (list) | `SkillForgeView` | order 30 | Skill Forge panel (injects `api: skillApi`). `src/client/index.ts#L134-L141` |
| `conversation.view` (list) | `ToolIntegrationsView` | order 40 | Tool Integrations panel (injects `api: mcpApi`). `src/client/index.ts#L143-L150` |
| `conversation.view` (list) | `A2AView` | order 50 | A2A Management panel (injects `api: a2aApi`). `src/client/index.ts#L152-L159` |
| `shell.overlay` (list) | `PetView` | default (0) | Global floating pet. `src/client/index.ts#L203-L206` |
| `shell.overlay` (list) | `TeamView` | order 110 | Team overlay (injects `api: teamApi`, `a2a: teamA2aApi`). `src/client/index.ts#L162-L167` |
| `sidebar.brand.mark` (single) | `PapergamesLogo` | priority −1 | Papergames brand mark shadowing the DeepSeek whale. `src/client/index.ts#L207-L210` |
| `sidebar.brand.name` (single) | `PapergamesWordmark` | priority −1 | Papergames brand name shadowing the official wordmark. `src/client/index.ts#L211-L214` |
| `conversation.hero.brand.mark` (single) | `PapergamesLogo` | priority −1 | Hero brand-mark swap on the new-session screen. `src/client/index.ts#L215-L218` |
| `sidebar.footer.action` (list) | `TeamTrigger` | order 5 | Sidebar "Team" entry opening the team overlay. `src/client/index.ts#L219-L223` |
| `sidebar.footer.action` (list) | `BackgroundSwitcher` | order 10 | Wallpaper + dim switcher beside Settings. `src/client/index.ts#L224-L228` |

All six rows are harness-declared slot rows (`conversation.view`, `shell.overlay`, `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, `sidebar.footer.action`), and the plugin's registrations depend on the exact kinds, scopes, and ordering/priority semantics supplied by the harness. The `/pet` command, brand/theme overlay, and shared publish/subscribe stores are described in [Dual-Face Plugin Architecture](/openwiki/architecture/overview.md) and are not themselves part of the harness contract.

## External `@deepseek-ai/*` modules resolved from the harness tree

The host Node bundle keeps its harness-runtime dependencies **external** (resolved from the dsh profile tree at runtime, the same stance as cordis) rather than bundling them from this repo's install. Declared in `tsdown.config.ts`'s `libExternal` (`tsdown.config.ts#L15-L21`):

- `@deepseek-ai/cordis` — the DI runtime (`Service`, `Context`, decorators).
- `@deepseek-ai/dsh-typert-protocol` — `Remote` decorator, `TypertRemoteService`, the wire envelope types.
- `@deepseek-ai/dsh-home-paths` — `dshHomePath(...)`, the profile-root resolver.
- `@deepseek-ai/dsh-tools` — `defineTool(...)` for model-facing tools.
- `@deepseek-ai/dsh-skill-filesystem` — `FileSystemSkillProvider` for the per-profile skill provider.

`@deepseek-ai/dsh-mcp-client` (`MCP_CLIENT`, `src/index.ts#L209`) is *not* a direct import: it is the **loader entry name** passed to `ctx.loader.create` for each configured MCP server (`src/index.ts#L265-L272`), so it resolves through the harness loader rather than through the bundler. These modules are mirrored in the `dsh.client.inject` client faces and the page-specific `@deepseek-ai/dsh-client-*` UI packages, which is the shell's client-side contract.

## Frozen browser module table

The shell shares a fixed set of browser modules into the web module table. `build/web-platform.ts` defines `PLATFORM_MODULES` as the single shared list so seeding, bundling externals, and Vite aliases cannot drift (`build/web-platform.ts#L12-L16`):

```text
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives
```

The client bundle resolves these as externals via `CLIENT_EXTERNALS = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]` (`build/tsdown.client.ts#L62`). `@deepseek-ai/dsh-client-runtime/client` is a documented *temporary* exemption (`RUNTIME_STORE_EXEMPTION`, `build/tsdown.client.ts#L59`) — the snapshot-store engine pending rehoming — not a platform module. Two further regexes decide what the client may *inline* rather than resolve externally: `INLINE_SAFE` (`build/tsdown.client.ts#L38`) matches the browser-safe wire/type contract surfaces (`@deepseek-ai/dsh-host-apiproxy`, `dsh-session`, `dsh-llm`, `dsh-tools`, `dsh-brand`) that carry no shared runtime identity, and `GENERATED_REMOTE` (`build/tsdown.client.ts#L41`) matches the generated `/remote` descriptor/codec contributions, which likewise have no shared runtime identity. The bundle inlines everything else; a `require()` the table cannot answer is a guaranteed runtime throw, so the rule is simply the table list itself. Full details are in [Build, Bundling, and Packaging](/openwiki/architecture/build-and-packaging.md).

## Peer runtime requirements

The package declares both a Node engine and React peers (`package.json#L19-L21`, `#L68-L71`):

- **`engines.node`**: `"^22.19.0 || >=24.0.0"` — the harness host must run Node 22.19+ or 24+.
- **`peerDependencies`**: `react` / `react-dom` `"^18.2.0"` — matching the frozen module-table `react` / `react-dom` entries, so the harness must provide React 18.

These are the runtime floor for the dual-face bundle: `lib/index.js` runs on Node, and `lib/client.js` runs on the React 18 provided through the loader module table.

## Invariants and re-verification

- **Contract accuracy is externally owned.** Every surface above (cordis service names, slot rows, module table, peer floor) is supplied by the harness, not by this repo. When the harness changes, `dsh.engines.dsh` and the `dsh.client.inject` list must be re-checked against the harness checkout, and the `pnpm run typecheck` gate is the authoritative proof of a drifted interface.
- **`dsh.engines.dsh` is the compat gate.** Raising the minimum in `dsh.engines.dsh` is the intended way to reject a harness whose contract no longer matches — a breaking harness change should be caught at install/type time rather than at runtime.
- **Slot registration depends on shell semantics.** The client assumes `list` rows render by ascending `order` and `single` brand/hero rows resolve by lowest `priority`. A harness change to those semantics breaks the brand shadowing and the panel ordering.

## Related pages

- [Dual-Face Plugin Architecture](/openwiki/architecture/overview.md) — the two faces at a glance and how they speak over the Typert remote bridge.
- [Build, Bundling, and Packaging](/openwiki/architecture/build-and-packaging.md) — the frozen module table, the closure-factory client preset, and why postbuild lowers decorators.
- [Client-to-Host Typert Remote Bridge](/openwiki/architecture/typert-remote-bridge.md) — the RPC contract the client consumes through `ctx.remote.<ns>`.
- [Per-Profile Isolation](/openwiki/concepts/per-profile-isolation.md) — the shared substrate for the Skill Forge, Tool Integrations, A2A, and Team host surfaces.
