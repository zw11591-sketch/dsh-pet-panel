---
type: workflow
title: Browser Client Surfaces
description: The dsh-pet-panel browser face — how src/client/index.ts wires the conversation-view and shell-overlay slot components (floating PetView desk pet, DashboardView metrics tab, SkillForge/Tool/A2A capability panels, Task Manager trigger+panel, BackgroundSwitcher), the Papergames brand/theme overlays, the /pet slash command, and the module-level petStore/taskStore cross-slot bridges.
tags: [browser-client, slot-wiring, pet-view, dashboard-view, task-manager, background-switcher, papergames-brand, papergames-theme, pet-command, slot-map, cross-slot-store, use-sync-external-store, conversation-view, shell-overlay]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-03T02:25:20.569Z
sources:
  - id: openwiki-source-227bb2ac7be2212e1d4973e2
    resource: repo://src/client/A2AView.tsx
  - id: openwiki-source-e04f7091d40291763b8ebb3e
    resource: repo://src/client/BackgroundSwitcher.tsx
  - id: openwiki-source-6c6ac6cf2b95aa6102617233
    resource: repo://src/client/bg.ts
  - id: openwiki-source-a692df6049a59ddd8480d952
    resource: repo://src/client/brand.tsx
  - id: openwiki-source-e58edde5612bdd131825e009
    resource: repo://src/client/DashboardView.tsx
  - id: openwiki-source-3503e2677e2cb13a4c324b90
    resource: repo://src/client/index.ts
  - id: openwiki-source-4b62cc8f9f8854ff99f8f4c3
    resource: repo://src/client/locales.ts
  - id: openwiki-source-13fa458a8e66fcc21d4b8230
    resource: repo://src/client/petStore.ts
  - id: openwiki-source-d49140f1a3ec31e4f82719f0
    resource: repo://src/client/PetView.tsx
  - id: openwiki-source-dab5c128ca228bb647a9e055
    resource: repo://src/client/SkillForgeView.tsx
  - id: openwiki-source-d097ebc5ffc22ca1c6d9f2c8
    resource: repo://src/client/TaskManagerTrigger.tsx
  - id: openwiki-source-9742e72527820196f9360004
    resource: repo://src/client/TaskManagerView.tsx
  - id: openwiki-source-0cf4a536b1ef488c94cb2f36
    resource: repo://src/client/taskStore.ts
  - id: openwiki-source-b319c6b1dce15a46c1bb9ee2
    resource: repo://src/client/theme.ts
generated: { by: "openwiki/0.5.0", at: "2026-09-03T02:25:20.569Z" }
---

# Browser Client Surfaces

The browser half of dsh-pet-panel is a single closure-factory bundle (`lib/client.js` from `src/client/index.ts`) that the web module loader serves into a DeepSeek Harness profile's shell. It never imports the host face. Instead it contributes **slot components** into the shell's slot maps, mounts three Typert remote namespaces against the host Gateways, swaps the Papergames identity, and registers a client-side slash command. This page is that face in detail: what each slot component does, how the surfaces are ordered and identified, how cross-slot state is shared without React context, and the load-order invariants the whole thing depends on.

The packaging that delivers this face, the Node host face that answers it, and the Typert wire contract are documented on [Dual-Face Plugin Architecture](/openwiki/architecture/overview.md) and [Client-to-Host Typert Remote Bridge](/openwiki/architecture/typert-remote-bridge.md); the session-trace reconstruction the Task Manager renders is documented on [Session Lifecycle Trace](/openwiki/concepts/session-lifecycle-events.md). This page is confined to the **browser side**.

## Entrypoint and the slot-wiring contract

`src/client/index.ts` declares the plugin's top-level injects (`['slots', 'locale', 'remote']`) and exports an async `apply(ctx)` that registers every client surface (`repo://src/client/index.ts#L34`, `repo://src/client/index.ts#L167-L238`). Registration goes through `ctx.slots.inject(slotName, () => ctx.slots.register({ name, id, order|priority, ... }, Component))` — the *slot name* and component identity/ordering are the only mechanism by which these surfaces appear. There is no imperative mounting of React trees.

```mermaid
flowchart TD
    apply["apply(ctx)"]
    theme["applyPapergamesTheme(ctx) — body token override"]
    brand["brand-favicon + hero-copy rewrite"]
    bg["applyBackground + applyDim from stored values"]
    locale["locale.register(NS, {zh,en})"]
    mount["remote.\u0024mount(TYPERT_REMOTE)"]
    view["conversation.view"]
    overlay["shell.overlay"]
    side["sidebar branding + footer action"]
    head["conversation.session.header.actions"]
    cap["pet-panel-capabilities child plugin"]
    cmd["pet-panel-command child plugin"]

    apply --> theme --> brand --> bg --> locale --> mount
    mount --> view -->|"dashboard o20 | skill-forge o30 | tool-integrations o40 | a2a-management o50"| view
    mount --> overlay -->|"pet (no order) | task-manager-panel o100"| overlay
    mount --> side -->|"brand.mark/-1 | brand.name/-1 | hero.brand.mark/-1 | footer .background o10"| side
    mount --> head -->|"task-manager o20"| head
    view --> cap
    overlay --> cap
    cap --> cmd
```

Caption: the client `apply()` sequence — theme/brand/background/locale first, then the Typert `$mount`, then slot registration, with the capability and command concerns pushed into child plugins that inject the mounted namespaces.

### Slot map, order, and priority

The ordering fields are not decorative — they determine tab order and shadowing:

| Slot map | id | order | priority | Component | Purpose |
| --- | --- | --- | --- | --- | --- |
| `conversation.view` | `dashboard` | 20 | — | `DashboardView` | session metrics tab |
| `conversation.view` | `skill-forge` | 30 | — | `SkillForgeView` | skill CRUD tab |
| `conversation.view` | `tool-integrations` | 40 | — | `ToolIntegrationsView` | MCP server CRUD tab |
| `conversation.view` | `a2a-management` | 50 | — | `A2AView` | A2A card / external-agent tab |
| `shell.overlay` | `pet` | (default) | — | `PetView` | floating desk pet |
| `shell.overlay` | `task-manager-panel` | 100 | — | `TaskManagerView` | task / lifecycle panel |
| `sidebar.brand.mark` | — | — | -1 | `PapergamesLogo` | logo mark shadow |
| `sidebar.brand.name` | — | — | -1 | `PapergamesWordmark` | wordmark shadow |
| `conversation.hero.brand.mark` | — | — | -1 | `PapergamesLogo` | hero logo shadow |
| `sidebar.footer.action` | `background` | 10 | — | `BackgroundSwitcher` | wallpaper + dim control |
| `conversation.session.header.actions` | `task-manager` | 20 | — | `TaskManagerTrigger` | task panel entry button |

`repo://src/client/index.ts#L120-L157` (capability + task-manager-panel), `repo://src/client/index.ts#L186-L219` (dashboard, pet, brand slots, background switcher, task trigger).

Two ordering facts are load-bearing.

- **`priority: -1` shadows the host brand.** `sidebar.brand.mark` / `sidebar.brand.name` / `conversation.hero.brand.mark` are `single` slots with default priority 0; the host `dsh-client-ui-brand-official` fills them. Registering at `-1` (the lowest-priority occupant renders) makes the shell show the Papergames identity instead of the whale mark (`repo://src/client/brand.tsx#L1-L8`).
- **The `task-manager-panel` is registered inside the capability child plugin, not the main `apply()`.** Its `inject: () => ({ lifecycle })` closure needs `remote.skillForge`, which resolves only after `$mount` and only inside a child context that lists it in its inject array. The main `apply()` context holds `remote` but not `remote.skillForge`, so touching it there throws `without inject` (`repo://src/client/index.ts#L147-L157`).

## Cross-slot state: module-level pub/sub stores

The command interceptor (`inputTriggers` source) and the pet body live in different slot maps; the Task Manager trigger and its overlay panel live in different slot maps too. React context cannot cross a slot boundary, so both pairs are bridged by **module-level publish/subscribe stores** exposing a stable `getSnapshot` plus a `subscribe` for `useSyncExternalStore` (`repo://src/client/petStore.ts#L1-L46`, `repo://src/client/taskStore.ts#L1-L45`).

- `petStore.isVisible()` returns the boolean, `show`/`hide`/`toggle` mutate it (only emitting on an actual change), and `subscribe` registers a listener. The default is `visible = true` — the pet shows by default (`repo://src/client/petStore.ts#L9-L10`).
- `taskPanelStore` is the identical shape for panel open/close (`repo://src/client/taskStore.ts#L9`, `repo://src/client/taskStore.ts#L16-L45`).

`PetView` reads visibility through `useSyncExternalStore(petStore.subscribe, petStore.isVisible)` (`repo://src/client/PetView.tsx#L292`), and `TaskManagerView` reads open-state the same way (`repo://src/client/TaskManagerView.tsx#L273`). Because the snapshot is a plain boolean that changes identity only on real transitions, the React external-store contract holds. This is the intended pattern to reuse when bridging shared state between two slot components — not React context.

## The floating PetView (`shell.overlay`)

`PetView` is a root-scope overlay (no session; it gets the global `useSessions` feed) that is draggable, resizable, skinnable, and emotes from a shared expression table. It renders **no binary sprite assets** — every character is inline SVG.

### Species and the shared FACES expression table

Five species are defined as a colored head plus species-defining `ears`/`detail` and an optional `mouthOverride` (the chick's beak replaces the mouth): cat, dog, rabbit, chick, dragon (`repo://src/client/PetView.tsx#L137-L205`). Each species reuses the same `FACES: Record<PetAction, Face>` table, where a `Face` selects an `EyeKind`, a `MouthKind`, whether to blink, an optional `talk`/`chomp` mouth animation, and optional cheeks — so every animal makes the same expressions with its own face (`repo://src/client/PetView.tsx#L40-L48`). The action set is `idle | busy | waiting | happy | eating | playing | sleeping` (`repo://src/client/PetView.tsx#L20`).

### Action derivation and lifecycle-reactive behavior

The resting action is **derived from the global session lifecycle feed**: `running > 0` → `'busy'`, else any session with `pendingInteraction` → `'waiting'`, else `'idle'`. A manual action (feed/play/sleep) overrides it for `MANUAL_MS` (4000 ms) through a separate `manual` state, then reverts to the derived value (`repo://src/client/PetView.tsx#L303-L306`, `repo://src/client/PetView.tsx#L314-L319`). Accessory glyphs float beside the pet for `eating`/`playing`/`sleeping` (`repo://src/client/PetView.tsx#L238-L242`).

The pet also *narrates* the lifecycle transition and self-entertains when idle:

- A transition effect announces the busy edge (`running` 0 → >0) and celebrates with `hold('happy', ...)` when the last running session finishes (`running` >0 → 0) (`repo://src/client/PetView.tsx#L322-L326`).
- While resting idle it re-arms a 16–36 s timer to speak a proactive line or do a little hop; the effect re-arms whenever the pet returns to idle, and cleans up on unmount (`repo://src/client/PetView.tsx#L330-L339`).

### Drag, persistence, and the click/drag distinction

Drag uses pointer capture on the element that owns the handlers (`.body`) so pointermove/up are not retargeted to an ancestor, and clamps the sprite to the viewport minus the scaled box (`box = 72 * size.scale`) (`repo://src/client/PetView.tsx#L349-L374`). A `DRAG_THRESHOLD` of 4 px separates a click from a drag: a pointerup that never moved past the threshold toggles the control panel and chatters (`repo://src/client/PetView.tsx#L376-L385`). Drag position is local state and is **not persisted**; only the chosen skin and size persist to `localStorage` (`dsh-pet-skin`, `dsh-pet-size`) with clamped reads for a missing/out-of-range index (`repo://src/client/PetView.tsx#L260-L268`, `repo://src/client/PetView.tsx#L341-L342`).

### Visibility and the hidden no-DOM invariant

When `visible` is false the component returns `<>` before any JSX — no sprite, bubble, or menu is rendered (`repo://src/client/PetView.tsx#L403`). So a hidden pet has no DOM footprint until `/pet on` flips the store.

## The Papergames brand and theme overlays

The client repaints the DeepSeek identity onto Papergames without touching host theme machinery or the official brand package.

- **Theme (`theme.ts`)** — `applyPapergamesTheme(ctx)` injects a `<style data-papergames-theme>` via `ctx.effect` (auto-removed on plugin dispose, the same pattern the host `dsh-client-ui-theme` uses). It remaps the `--dsw-static-deepseek-*` blue ramp (`#edf3fe → #283142`, brand `#4176e6`) onto the Papergames coral ramp anchored at the mark color `#F36864`, plus background-glass and base-bg token overrides (`repo://src/client/theme.ts#L1-L47`, `repo://src/client/theme.ts#L50-L57`). The rule **must target `body`, not `:root`**, because the host installs its tokens on `body` and a `:root` rule loses to the host's `body` rule (a descendant re-declares the same custom properties).
- **Brand (`brand.tsx`)** — `PapergamesLogo` (five coral bars with white circular cutouts, redrawn as vectors at 84×56) and `PapergamesWordmark` fill the brand slots at `priority: -1` (`repo://src/client/brand.tsx#L17-L63`). `applyPapergamesFavicon` repoints `link[rel=icon].href` to an inline SVG data URI; `applyHeroCopyRewrite` uses a `MutationObserver` because re-registering a namespace+locale that already exists throws `already has locale`, so the DeepSeek slogan `探索未至之境` is rewritten to `叠纸游戏-Papergames` and the `预览版` badge is hidden at the DOM level, returning a dispose function for the plugin to clean up (`repo://src/client/brand.tsx#L95-L150`).

Both are applied in the first lines of `apply()` before any slot registration (`repo://src/client/index.ts#L169-L177`).

## The DashboardView (`conversation.view`, order 20)

`DashboardView` is a self-contained metrics page that derives **every figure from standard framework feeds** — the `useSessions` `byId` summary map, `useWorkspaces` archived-session ids, and the `dsh-token-meter` projection values (context pressure / breakdown / token usage) on the current session (`repo://src/client/DashboardView.tsx#L303-L319`). It is three local-switchable sections: Overview, Analytics, About (`repo://src/client/DashboardView.tsx#L15-L17`).

All aggregation lives in pure helpers wrapped in `useMemo`, keyed on the session map:

- `weeklyActivity` buckets non-blank sessions into a trailing-7-day window, oldest bar first (`repo://src/client/DashboardView.tsx#L55-L74`).
- `sessionStats` tallies total / running / today's non-blank sessions (`repo://src/client/DashboardView.tsx#L83-L93`).
- `tokenOverview` aggregates whole-log billed tokens across sessions and ranks the top spenders (cumulative spend-to-date, not a windowed rate) (`repo://src/client/DashboardView.tsx#L133-L149`).
- `contextUsage` and `contextAnalysis` build the context gauge, remaining budget, system/tools/messages breakdown, billing buckets, and cache-hit share (`repo://src/client/DashboardView.tsx#L180-L192`, `repo://src/client/DashboardView.tsx#L228-L262`).

The Overview tab renders a context gauge plus session tallies, a 7-day activity bar chart, archived-session and fork/session lists (marking subagent-origin rows). The Analytics tab renders a token-spend ranking and a detailed current-session context analysis. The context gauge mirrors the composer's ContextMeter: numerator is the provider-anchored `projectedTokens` (falling back to `pressureTokens`), denominator is the newest route `contextWindow`; both must be known before a percent renders, otherwise the card shows "等待首次请求…" (`repo://src/client/DashboardView.tsx#L346-L366`).

## Capability panels: SkillForge / ToolIntegrations / A2A

Three `conversation.view` tabs (orders 30 / 40 / 50) are thin CRUD editors over the three Typert namespaces. Each receives an `api` object injected via `inject: () => ({ api })`, and each `api` method is a `unwrap()`-wrapped call into `ctx.remote.<ns>` (`repo://src/client/index.ts#L100-L118`).

- `SkillForgeView` lists, reads, writes, deletes, and AI-generates `skills/<name>/SKILL.md` for the current profile (`repo://src/client/SkillForgeView.tsx#L1-L69`). `generate` calls `ctx.remote.skillForge.generate(description)` and surfaces the model's returned content into the editor.
- `ToolIntegrationsView` manages MCP server configs (`repo://src/client/ToolIntegrationsView.tsx#L1-L70`), parsing `args`/`env`/`headers` from textareas and writing the config back so the host hot-mounts the server.
- `A2AView` manages the local agent card and a list of external agents, deriving the card and message URLs from `window.location.origin` (`/.well-known/agent-card.json`, `/a2a`) and showing a fixed toast on success/failure (`repo://src/client/A2AView.tsx#L1-L70`).

The wire codecs and the mount/`unwrap` mechanics are the Typert bridge's job; here the relevant fact is that these views are **read-only consumers of the injected `api`**, never touching `ctx.remote` directly, and that the whole trio is registered by the `pet-panel-capabilities` child plugin (`repo://src/client/index.ts#L222-L228`).

## Task Manager: trigger, panel, and lifecycle fetch

The Task Manager is a two-piece surface bridged by `taskPanelStore`.

- **`TaskManagerTrigger`** (`conversation.session.header.actions`, order 20) is a session-header button whose only job is `taskPanelStore.openPanel` on click; it reads nothing from the store (`repo://src/client/TaskManagerTrigger.tsx#L21-L33`).
- **`TaskManagerView`** (`shell.overlay`, order 100) is root-scope — `PropsRuntime<'shell.overlay'>` plus an optional injected `lifecycle` prop (`repo://src/client/TaskManagerView.tsx#L26-L28`). It reads `taskPanelStore.isOpen` via `useSyncExternalStore` and returns `null` when closed (`repo://src/client/TaskManagerView.tsx#L270-L273`, `repo://src/client/TaskManagerView.tsx#L315`). It renders a full-screen overlay that closes on outside click, with a list tab and a lifecycle tab.

**List tab** — per-session rows read `projectionValues.todos` (a locally-declared `TodoItem` type matching `dsh-session`'s, chosen so the plugin does not add the `dsh-tool-todo` dependency) and render a session-status badge plus a collapsible per-session todo list with pending/active/done counts (`repo://src/client/TaskManagerView.tsx#L16-L24`, `repo://src/client/TaskManagerView.tsx#L71-L110`, `repo://src/client/TaskManagerView.tsx#L281-L289`).

**Lifecycle (flow) tab** — `buildTree` assembles a subagent lineage tree from `parentId`, treating orphaned sessions as roots (`repo://src/client/TaskManagerView.tsx#L51-L68`). Clicking a node lazily fetches that session's execution trace via the injected `lifecycle(sessionId)` wrapper, which is exactly `unwrap(await ctx.remote.skillForge.lifecycle(sessionId))` (`repo://src/client/index.ts#L150-L151`). Results are cached per session id, and loading / error states are tracked per node (`repo://src/client/TaskManagerView.tsx#L293-L313`). The host-side reconstruction that this call performs is covered on [Session Lifecycle Trace](/openwiki/concepts/session-lifecycle-events.md); here it is enough to note that the panel treats it as an opaque, lazily-loaded, cached snapshot.

## Background switcher and `bg.ts` inline wallpapers

`BackgroundSwitcher` (sidebar footer action, order 10) is a small popover that lists `GAME_BACKGROUNDS` and a dim slider (`repo://src/client/BackgroundSwitcher.tsx#L27-L100`). Choices and dim are persisted to `localStorage` and reapplied on startup in `apply()` (`repo://src/client/index.ts#L175-L177`). The actual application targets inline `body` custom properties:

- `applyBackground(key)` sets `--pg-bg-image` to the chosen game's CSS `url(...)` and persists the key (`repo://src/client/bg.ts#L45-L54`).
- `applyDim(t)` clamps to `[BG_DIM_MIN, BG_DIM_MAX]`, then writes `--pg-bg-dim` (a black-overlay strength, 0 → 0.7) and a *glass-layer* alpha derived from it into `--dsw-specific-sidebar-fill` and the `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1..3` tokens, so the wallpaper's translucency and text legibility are coupled (`repo://src/client/bg.ts#L84-L102`).
- The `--pg-bg-*` variables are the seam the Papergames theme (`theme.ts`) references in its `body` rule (`repo://src/client/theme.ts#L40`).

`DEEPSPACE_BG` and the other three wallpapers are **inlined as base64 `data:image/webp` URIs** (1600×900) rather than served asset URLs, so the client bundle carries no extra network requests (`repo://src/client/bg.ts#L1-L21`).

## The `/pet` slash command

`registerPetCommand` adds a custom `inputTriggers` source on the `/` trigger. The built-in dsh command source already claims `/`, but its `matchEnter` returns `undefined` for unknown commands like `/pet on`; `adjudicate` polls sources in registration order and the first non-`undefined` wins, so registering **after** the built-in source lets this one take over `/pet` (`repo://src/client/index.ts#L42-L96`).

- `candidates` lists a `pet` menu entry (hint `on | off`) when the query is empty or a prefix of `pet` (`repo://src/client/index.ts#L57-L62`).
- `onPick` toggles the pet and consumes the input via `slash/input-consume-token` with a span guard (`repo://src/client/index.ts#L63-L75`).
- `matchEnter` matches `/^\/pet(?:\s+(on|off|toggle))?$/i`, calls `petStore.show()/hide()/toggle()` (defaulting to `toggle`), consumes the line via `slash/input-consume-token` with a bare-token guard, and returns `'handled'` — which **swallows the line so it is never sent to the model** (`repo://src/client/index.ts#L76-L94`).

Consumption failures are caught and ignored (the pet state change is not rolled back). This is why the command is registered in the `pet-panel-command` child plugin injecting `['inputTriggers', 'sessions']` (`repo://src/client/index.ts#L231-L237`).

## Locale and the `dashboard` namespace

The client ships `zh` / `en` dictionaries under namespace `dashboard`, declared in `locales.ts` and typed into the slot `LocaleNamespaceMap` (`repo://src/client/locales.ts#L4-L23`). `apply()` registers them via `ctx.locale.register(NS, { zh, en })` and binds `t = ctx.locale.bind(NS)`, which labels the dashboard tab and the skill-forge / tool-integrations / a2a tabs (`repo://src/client/index.ts#L178-L179`). Because the namespace is owned by this plugin, the capability views and dashboard read `PropsLocale<'dashboard'>`.
