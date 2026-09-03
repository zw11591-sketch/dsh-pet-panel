---
type: concept
title: Client-to-Host Typert Remote Bridge
description: The explicit RPC boundary between the dsh-pet-panel browser client bundle and the Node host bundle — the hand-written TYPERT_REMOTE manifest with strict zod codecs in src/client/remote.ts, the @Remote-decorated TypertRemoteService gateways in src/index.ts discovered in source mode, the { ok:true, value } | { ok:false, error } wire envelope, the unwrap()/compact() helpers, and the ordering constraint that the capability child plugin touches remote.<ns> only after $mount.
tags: [typert-remote, rpc-boundary, wire-codec, zod, remote-bridge, skill-forge, tool-integrations, a2a, source-mode, json-safety, unwrap, compact]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-03T02:25:20.569Z
sources:
  - id: openwiki-source-3503e2677e2cb13a4c324b90
    resource: repo://src/client/index.ts
  - id: openwiki-source-9574f44db93f6ce7d70675b2
    resource: repo://src/client/remote.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "openwiki/0.5.0", at: "2026-09-03T02:25:20.569Z" }
---

# Client-to-Host Typert Remote Bridge

dsh-pet-panel is built as **two faces that never share imports across the host/client edge**. The Node host bundle (`src/index.ts`) runs Cordis Gateways; the browser client bundle (`src/client/index.ts`) runs React slot views. The only thing that connects them is the **Typert remote bridge** — an explicit RPC contract where the host advertises methods and the client consumes them through a hand-written manifest. This page is the contract in detail: what each side declares, how the wire envelope is shaped, why the strict zod codecs and `compact()` exist, and the load-order constraint that keeps the capability views from touching an unmounted namespace.

```mermaid
sequenceDiagram
    participant View as Capability View (browser)
    participant CapCtx as Capabilities child plugin
    participant ClientRemote as ctx.remote (TypertClientRemote)
    participant Carrier as RPC carrier (connection /api)
    participant Gateway as Host TypertGatewayService
    participant GW as Host Gateway method

    View->>CapCtx: calls injected api wrappers
    CapCtx->>ClientRemote: ctx.remote.skillForge.list()
    ClientRemote->>Carrier: RPC request skillForge/list (args)
    Carrier->>Gateway: intercept /api endpoint
    Gateway->>Gateway: claims endpoint from @Remote markers (source mode)
    Gateway->>GW: invoke business method
    GW-->>Gateway: business result value
    Gateway-->>ClientRemote: envelope { ok:true, value } or { ok:false, error }
    ClientRemote-->>CapCtx: unwrap throws on ok:false, else value
    CapCtx-->>View: resolved / thrown result
```

Caption: The request flow from a capability view through the mounted Typert client remote, across the RPC carrier, to a source-mode-discovered host Gateway method, and the result envelope back to `unwrap()`.

## The two sides of the boundary

The host only needs to *decorate* its methods; the client only needs to *describe* them. Neither side imports the other's implementation.

- **Host face (`src/index.ts`)** — three Gateways subclass `TypertRemoteService` and annotate public instance methods with `@Remote('<method>')`: `SkillForgeGateway` (`src/index.ts#L159-L410`), `ToolIntegrationsGateway` (`src/index.ts#L431-L535`), and `A2AConfigGateway` (`src/index.ts#L638-L704`). The `TypertRemoteService` constructor binds `this.typertRemote` to the same Cordis service key and wire namespace (`src/index.ts#L159-L169`, `#L431-L442`, `#L638-L641`). Each `@Remote` method returns a **JSON-safe business value** (for example `{ items: [...] }`, `{ serverName }`, or a full `LifecycleSnapshot`).
- **Client face (`src/client/remote.ts`)** — a hand-written `TYPERT_REMOTE` manifest (`src/client/remote.ts#L138-L159`) with `package`, `descriptors`, and per-method **wire codecs** that mirror the host method signatures. The client never sees the Gateways; it mounts this manifest onto the Typert client remote and calls the namespaces through `ctx.remote.<ns>.<method>()`.

### The source-mode discovery rationale

The host identity of each method is discovered **without a generated `/typert` artifact**. The Typert Gateway service scans active Cordis Services, reads the `typertRemote` binding (`namespace`/`serviceKey`), and consults the private `@Remote` marker table (`remoteMethods`) to claim endpoints. The client manifest's descriptors therefore only need to be *compatible* with the host signatures — they are not a compiler-generated contract. The bridge is kept in sync by hand (see [Keeping the two halves in sync](#keeping-the-two-halves-in-sync)).

## The wire result envelope

The framework wraps every resolved business value into a discriminated envelope, and every failure into the other branch:

```
{ ok: true,  value: T }   |   { ok: false, error: { code, message, details } }
```

On the client, `unwrap()` collapses this envelope:

```ts
function unwrap<T>(r: { ok: true; value: T } | { ok: false; error?: { message?: string } }): T {
  if (!r.ok) throw new Error(r.error?.message ?? 'remote call failed')
  return r.value
}
```

`src/client/index.ts#L36-L40`. When `r.ok` is false the helper throws an `Error` carrying `r.error.message`. The capability views build their `api` objects by wrapping every call in `unwrap()`, so a host-side failure surfaces as a `Promise` rejection that each view's `try/catch` renders as an inline error (`src/client/index.ts#L100-L118`, `src/client/SkillForgeView.tsx#L40-L47`, `src/client/A2AView.tsx#L53-L61`). The host-side `rpcFailure` mapping is what fills the error branch with `code`, `message`, and `details`, keeping boundary values out of the message.

## The manifest: ids, descriptors, and strict codecs

`src/client/remote.ts` builds each descriptor with a small set of helpers whose outputs match the protocol's `InvocationDescriptor` / `InvocationParameterDescriptor` / `TypertCodec` shapes (`src/client/remote.ts#L100-L136`):

- `jsonParam(name, schema)` — a position parameter with `source: 'json'`, wire name equal to the source name, and a **strict** codec (`mode: 'strict'`, `typeSymbol: dsh-pet-panel#param/<name>`, `schema`) (`src/client/remote.ts#L100-L108`).
- `strictResult(typeSymbol, schema)` — the method's business-return codec, also strict (`src/client/remote.ts#L110-L113`).
- `descriptor(namespace, method, parameters, resultSchema)` — assembles `{ id: dsh-pet-panel#<namespace>/<method>, service: namespace, namespace, method, invocation: { kind: 'direct' }, parameters, result }` (`src/client/remote.ts#L121-L136`).

Every entry uses `invocation: { kind: 'direct' }` because these are direct, unsorted calls (the `@Remote` markers on the host side are all direct too).

### Full descriptor surface

The manifest covers three namespaces and fourteen methods, each with a strict result schema:

- **`skillForge`** — `list` → `{ items: SkillSummary[] }`; `read(name)` → `{ name, content }`; `write(name, content)` → `{ name }`; `delete(name)` → `{ name }`; `generate(description)` → `{ content }`; `lifecycle(sessionId)` → `LifecycleSnapshot` (`src/client/remote.ts#L141-L147`). The `lifecycle` result is the richest: `{ title, turns, steps, toolCalls, approvals, todoWrites, startedAt, endedAt, events[] }` where each event has scalar stats plus a large set of `.optional()` fields (`src/client/remote.ts#L30-L58`).
- **`toolIntegrations`** — `list` → `{ items: McpConfig & { mounted }[] }`; `read(serverName)` → `{ config }`; `write(config)` → `{ serverName }`; `delete(serverName)` → `{ serverName }` (`src/client/remote.ts#L148-L152`). `mcpConfig` uses an enum for `transport` (`stdio` | `streamable-http`) and `.optional()` for `command` / `args` / `env` / `cwd` / `url` / `headers` (`src/client/remote.ts#L62-L75`).
- **`a2aConfig`** — `get` → `{ card, agents }`; `setCard(card)` → `{ card }`; `upsertAgent(externalAgent)` → `{ name }`; `delete(name)` → `{ name }` (`src/client/remote.ts#L153-L157`). `a2aExternalAgent` has `.optional()` `keywords` and `examples` (`src/client/remote.ts#L84-L94`).

The client also re-exports the inferred types it hands to its views — `LifecycleEvent`, `LifecycleSnapshot`, `A2ACard`, `A2AExternalAgent`, `A2AConfig` (`src/client/remote.ts#L57-L58`, `#L96-L98`) — which are the same shapes the host returns.

## Why `compact()` is mandatory

The Typert boundary validates that any value crossing it is **JSON-safe**. `assertJsonValue` rejects non-plain objects, cyclic values, non-finite numbers, weakmap/symbol/sparse traps, and — critically — **`undefined`**: a plain object whose own property has `value: undefined` is not JSON-safe (`src/index.ts#L147-L157`).

The problem is that zod `.optional()` parsing does **not** delete the key when the value is absent — it leaves an own property whose value is `undefined`. So a host method that returns e.g. a `tool-call` event without a `step` (which happens constantly while folding a session trace) would produce `{ step: undefined }`, and Typert would reject the whole payload with `"undefined is not JSON-safe"`, surfacing as a bogus "business result failed boundary validation".

The host strips those properties before returning, in `compact()`:

```ts
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}
```

`src/index.ts#L151-L157`. It is applied **per event** as it builds the `lifecycle` events (`src/index.ts#L346-L403`) and once more to the final `lifecycle` snapshot (`src/index.ts#L408`). Every `{ seq, time, kind, turn, step, ... }` literal is wrapped in `compact(...)` precisely because the optional `turn` / `step` / `text` / `toolName` / `toolArgs` / `isError` / `outcome` / `reason` / `todos` fields are conditionally `undefined`.

`compact()` is only needed in the lifecycle path and any other method whose result can contain a `.optional()` field that is genuinely absent. The `skillForge` and `toolIntegrations` business values are all-required, so they cross the boundary untouched; the `a2aExternalAgent` optional `keywords`/`examples` are normalized to empty arrays on the host side before return, so they are never `undefined` (`src/index.ts#L680-L693`).

## Keeping the two halves in sync

Adding or changing a remote method requires editing **both** sides:

1. Add (or rename) the `@Remote('<method>')` on the host `TypertRemoteService` subclass in `src/index.ts`, keeping the parameter list JSON-serializable and the return value JSON-safe.
2. Add (or update) a matching `descriptor(...)` in `src/client/remote.ts`, with `jsonParam` entries in the same order as the host method parameters and a strict zod result schema that matches the host return type.

The host does not need a generated artifact — the api-gateway reflects the `@Remote` markers at runtime. The client manifest is the only thing that tells the client how to encode parameters and decode the result, so a mismatch between the two produces an ambiguous endpoint or a "business result failed boundary validation" from the strict result codec. Because the host `SkillForgeGateway`/`ToolIntegrationsGateway`/`A2AConfigGateway` types and the client zod schemas mirror one another (`LifecycleEvent`/`LifecycleSnapshot` as interfaces in `src/index.ts#L48-L74` vs. `z.infer` in `src/client/remote.ts#L57-L58`), the two are verified against each other at build time only by matching shapes, not by a shared type.

## Mount order: namespaces resolve only after `$mount`

The bridge is mounted in `apply(ctx)` with:

```ts
const disposeRemote = await (ctx as any).remote.$mount(TYPERT_REMOTE)
ctx.effect(() => disposeRemote, 'pet-panel: unmount remote')
```

`src/client/index.ts#L181-L183`. The main client context inject is `['slots', 'locale', 'remote']` (`src/client/index.ts#L34`) — it only holds the `remote` service itself, not the mounted namespace sub-services.

This is why the **capability views are not registered in `apply()`**. They live in a child plugin `pet-panel-capabilities` whose inject list is `['slots', 'locale', 'remote', 'remote.skillForge', 'remote.toolIntegrations', 'remote.a2aConfig']` (`src/client/index.ts#L221-L228`). The `remote.<ns>` entries are the namespace services mounted by `$mount`; they resolve only against the now-mounted namespaces inside that child plugin. The `TaskManagerView`'s `lifecycle` wrapper is registered here for the same reason — it calls `ctx.remote.skillForge.lifecycle(...)` (`src/client/index.ts#L147-L157`). Touching `remote.skillForge` in the main `apply(ctx)` body would throw `without inject`, because that context only knows `remote`.

## Failure and lifecycle invariants

- **Disposal is fiber-scoped.** `$mount` returns a disposer (`TypertDisposer`) registered via `ctx.effect`, so unloading the plugin withdraws the exact contribution (`src/client/index.ts#L181-L183`).
- **Host method errors carry identity, boundary errors carry safety.** The api-gateway distinguishes business method throws (passed through) from infrastructure failures (wrapped with an endpoint and no boundary values). The client sees all of them as `{ ok: false, error }`, and `unwrap()` surfaces the message.
- **`compact()` must be re-applied to any new optional field a host method produces**, or the strict result codec rejects the payload at the boundary.
- **The a2a `get` result is a config object**, and the host normalizes optional agent fields to empty arrays before returning, so `a2aConfig` results are always JSON-safe without `compact()`.

## Related pages

- [Dual-Face Plugin Architecture](/openwiki/architecture/overview.md) — the top-level map of the two faces and the packaging wiring that makes `lib/index.js` and `lib/client.js` the two halves.
- [Build, Bundling, and Packaging](/openwiki/architecture/build-and-packaging.md) — how the host and client bundles are emitted, and why the `@Remote` decorators must be lowered by `tsc` for the host half.
