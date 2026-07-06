# Spin Wasm Compatibility

This document describes what works natively in the Spin Wasm runtime, what
requires workarounds, and what is stubbed out for this project.

The app runs as a Next.js App Router application compiled to a Spin Wasm
component via [vinext](https://github.com/nicholasgasior/vinext) and
[componentize-js](https://github.com/bytecodealliance/componentize-js). The
JavaScript runtime inside the Wasm is
[StarlingMonkey](https://github.com/bytecodealliance/StarlingMonkey)
(SpiderMonkey-based).

---

## What Works

| Feature | Notes |
|---|---|
| Next.js App Router (RSC + SSR) | Pages, layouts, route handlers all work |
| next-intl i18n | Static translation strings only — see ICU section below |
| PostgreSQL via `@spinframework/spin-postgres` | Uses WIT bindings; see caveats |
| Clerk authentication | Works with real keys; outbound HTTPS is allowed |
| Arcjet bot protection | Optional; disabled when `ARCJET_KEY` is unset |
| Middleware (`proxy.ts`) | Runs per-request in the Wasm component |
| Static file serving | via separate Spin components (`root-assets`, `client-assets`) |
| API route handlers | `app/api/**` works normally |
| `fetch()` | Available inside request handlers (not at module init time) |
| Tailwind CSS | Compiled to static CSS at build time, no runtime needed |

---

## Known Limitations and Workarounds

### ICU message formatting (`{variable}` in translations)

**Problem:** `intl-messageformat` (used by next-intl) calls `new Intl.PluralRules`
and `new Intl.NumberFormat` when compiling messages that contain variables.
StarlingMonkey has limited `Intl` support — these constructors throw, which
causes next-intl to return the translation key path as a fallback and log
`INVALID_MESSAGE` errors.

**Rule:** Never pass variables to `t('key', { var })` in server components.

**Workaround:** Remove the `{variable}` from the translation string and render
the value directly as a JSX expression:

```tsx
// ❌ Breaks on Spin
t('count', { count })       // "Count: {count}"

// ✅ Works on Spin
<>{t('count')} {count}</>   // "Count:" + value
```

For rich text with inline elements (e.g. `t.rich('footer', { link: () => <a> })`),
inline the entire JSX structure and use the translation string only for the
static text portion.

This applies to:
- All `{variable}` interpolations
- All `t.rich(...)` calls with tag components
- Plural forms (`{count, plural, ...}`)

---

### PostgreSQL — empty SELECT results hang

**Problem:** The Spin Postgres WIT binding silently hangs (never resolves)
when a `SELECT` query returns zero rows.

**Workaround:** Use an aggregate that always returns exactly one row:

```ts
// ❌ Hangs when no row exists
db.select({ count: schema.count }).from(schema).where(eq(schema.id, id)).limit(1)

// ✅ Always returns 1 row
db.select({ count: sql<number>`COALESCE(MAX(${schema.count}), 0)` })
  .from(schema).where(eq(schema.id, id))
```

---

### PostgreSQL — `int64` parameter type requires `BigInt`

**Problem:** The WIT binding for `{ tag: 'int64', val }` requires a JavaScript
`BigInt`. Passing a plain `Number` causes a silent hang (no error thrown).

**Rule:** Always use `BigInt(n)` when constructing int64 WIT parameters.

This is handled automatically in `src/spin-pg-adapter.ts`.

---

### PostgreSQL — `Date` objects as query parameters

**Problem:** Drizzle's `$onUpdate(() => new Date())` injects a JavaScript `Date`
as a WIT `datetime` parameter. While the adapter converts it correctly, passing
dates through WIT is fragile.

**Workaround:** Use a server-side SQL expression so the database evaluates it:

```ts
// ❌ Fragile — Date goes through WIT binding
$onUpdate(() => new Date())

// ✅ Safe — evaluated by PostgreSQL
$onUpdate(() => sql`now()`)
```

---

### Drizzle ORM — relational API vs builder API

**Problem:** `db.query.table.findFirst()` (the Drizzle relational API) uses
`NodePgPreparedQuery` with `rowMode: 'array'` which can cause hangs via a
different code path.

**Rule:** Use the builder API for all queries in this codebase:

```ts
// ❌ Avoid — can hang
db.query.counterSchema.findFirst({ where: eq(counterSchema.id, id) })

// ✅ Use builder API
db.select({ count: counterSchema.count }).from(counterSchema).where(...)
```

---

### `new RegExp()` with Unicode property escapes (`\p{...}`)

**Problem:** StarlingMonkey does not support Unicode property escapes in
`new RegExp()` calls (only in regex literals).

**Workaround:** The build pipeline (`build.mjs`) automatically patches these
occurrences in the compiled bundle, replacing `new RegExp("\\p{...}", "u")` with
an equivalent character class.

---

### `setTimeout` / `setInterval` at module init time

**Problem:** StarlingMonkey does not allow timers during module initialisation
(i.e. at the top level of a module). Timers work inside request handlers.

---

### `fetch()` at module init time

**Problem:** Outbound `fetch()` calls cannot be made during module
initialisation. They work normally inside request handlers and server components.

This is why the Arcjet `@arcjet/next` package is stubbed — it attempts to
`fetch` a Wasm rules file during init.

---

### `_vinext/image` with `data:` URIs → HTTP 400

**Problem:** vinext's image optimisation endpoint (`/_vinext/image`) does not
handle `data:` URI inputs. When Next.js `<Image>` receives an imported SVG
(which Rolldown inlines as a data URI), the `/_vinext/image` request returns
400. The image won't display but the page renders correctly.

**Workaround:** Use a plain `<img src="/assets/images/...">` for images that are
imported as modules.

---

## Stubbed Packages

These packages are replaced with no-op stubs in the Spin build because they
depend on Node.js APIs unavailable in StarlingMonkey.

### `@sentry/nextjs` → `src/stubs/sentry.ts`

Sentry's SDK requires `net`, `http`, `fs`, and other Node APIs to transport
events. All exported functions are no-ops. Errors will not be reported to
Sentry when running under Spin.

**Alternative:** Use Sentry's Edge-compatible transport or route errors to a
logging service that uses plain `fetch()` (e.g. BetterStack is already wired up
via `NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN`).

### `@arcjet/next` → `src/stubs/arcjet.ts`

Arcjet loads a Wasm ruleset via `fetch()` at module init time, which is
prohibited in StarlingMonkey. The stub allows all requests (returns `isDenied: false`).

**Note:** Arcjet protection can be enabled conditionally in
`proxy.ts` via the `ARCJET_KEY` env var — but the stub would need to be
replaced with a runtime-compatible implementation first.

---

## Clerk Authentication

Clerk **can work** with Spin. The middleware (`proxy.ts`) only invokes
`clerkMiddleware` for auth-gated routes (`/sign-in`, `/sign-up`, `/dashboard`).
Clerk verifies tokens via outbound HTTPS calls, which Spin allows via
`allowed_outbound_hosts = ["https://*"]` in `spin.toml`.

### Getting real Clerk keys (free)

1. Create a free account at [clerk.com](https://clerk.com)
2. Create a new application (choose "Next.js")
3. Copy `CLERK_SECRET_KEY` (starts with `sk_test_...`) and
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_test_...`)
4. Set them in `build.mjs` under the `define` block:
   ```js
   'process.env.CLERK_SECRET_KEY': '"sk_test_YOUR_KEY"',
   'process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': '"pk_test_YOUR_KEY"',
   ```
5. For the dev Next.js server, add to `.env.local`:
   ```
   CLERK_SECRET_KEY=sk_test_YOUR_KEY
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY
   ```
6. Rebuild: `npm run build`

The sign-in/sign-up pages use Clerk's `<SignIn>` and `<SignUp>` components
which render via RSC and require a valid publishable key to load the Clerk JS.

---

## Node.js Module Stubs

The following Node.js built-in modules are shimmed in the esbuild bundle
(`build.mjs`) because StarlingMonkey does not include them:

| Module | What's stubbed |
|---|---|
| `node:fs` / `fs` | Empty no-op implementation |
| `node:url` | `URL`, `URLSearchParams`, `fileURLToPath`, `pathToFileURL` |
| `node:tty` | `isatty`, `ReadStream`, `WriteStream` |
| `node:module` | `createRequire`, `isBuiltin`, `builtinModules` |
| `node:zlib` | No-op (gzip/brotli not needed for RSC responses) |
| `node:http` | No-op (direct HTTP not used; `fetch()` is used instead) |
| `node:net` | No-op sockets |
| `node:os` | `platform`, `hostname`, `tmpdir`, etc. |
| `node:stream` | No-op streams |
| `node:worker_threads` | No-op |
| `node:readline` | No-op |
| `node:inspector` | No-op |
| `pg` | Replaced by `src/spin-pg-adapter.ts` (Spin WIT bindings) |

---

## Local Development vs Spin

| | `npm run dev` | `npm run test:e2e:spin` |
|---|---|---|
| Runtime | Node.js 22 | StarlingMonkey (Wasm) |
| Database | PGlite (in-process) | PostgreSQL 17 (Docker) |
| Auth | Clerk (real keys in `.env.local`) | Clerk (keys in `build.mjs`) |
| Image optimisation | Next.js sharp | vinext (redirect / 400 for data URIs) |
| `fetch()` at init | ✅ | ❌ |
| `Intl.PluralRules` | ✅ | ❌ |
| `setTimeout` at init | ✅ | ❌ |
| Unicode `\p{}` regex | ✅ | ✅ (patched at build time) |
