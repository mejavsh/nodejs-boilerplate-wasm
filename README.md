# Next.js Boilerplate on Fermyon Spin / Akamai Wasm Functions

> An experimental port of Next.js Boilerplate (vinext) running as a WebAssembly component on Fermyon Spin and Akamai Wasm Functions. Supports SSR, React Server Components, Drizzle ORM + Postgres, Clerk Auth, and i18n — all inside a single WASM binary.

---

## Prerequisites

- [Node.js](https://nodejs.org) v18.17+
- [Spin CLI](https://developer.fermyon.com/spin/install)
- [Fermyon Wasm Functions plugin](https://developer.fermyon.com/wasm-functions/quickstart)

```bash
# Install Spin CLI
curl -fsSL https://developer.fermyon.com/downloads/install.sh | bash

# Install Fermyon Wasm Functions plugin
spin plugins install aka

# Login to Fermyon (once)
spin aka login
```

---

## Step 1 — Configure Clerk Auth

This project uses [Clerk](https://clerk.com) for authentication.

1. Sign up at [clerk.com](https://clerk.com) — free, no credit card needed
2. Create a new application and choose **Next.js**
3. Go to **API Keys** in your Clerk dashboard
4. Copy both keys — they must be from the **same application**

Open `build.mjs` and update lines 442 and 444:

```js
'process.env.CLERK_SECRET_KEY': '"sk_test_YOUR_CLERK_SECRET_KEY"',
'process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': '"pk_test_YOUR_CLERK_PUBLISHABLE_KEY"',
```

Also update `.env`:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=sk_test_YOUR_CLERK_SECRET_KEY
```

---

## Step 2 — Configure Postgres Database (Neon)

This project uses [Neon](https://neon.tech) as the Postgres database — free tier, no credit card needed.

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project
3. Copy your connection string — it looks like:
   ```
   postgresql://user:password@ep-xxx.ap-southeast-2.aws.neon.tech/neondb?sslmode=require
   ```

### Create the database table

Connect to your Neon database and run:

```sql
CREATE TABLE "counter" (
  "id" serial PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
```

### Update `build.mjs` line 443

```js
// Remove ?sslmode=require from the URL — Spin WIT binding handles SSL internally
'process.env.DATABASE_URL': '"postgresql://user:password@ep-xxx.aws.neon.tech/neondb"',
```

### Update `spin.toml`

Find `allowed_outbound_hosts` and replace the Neon hostname:

```toml
allowed_outbound_hosts = ["https://*", "http://*", "postgres://YOUR_NEON_HOSTNAME:5432"]
```

Your Neon hostname is the part between `@` and `/neondb` in your connection string.

---

## Step 3 — Run Locally

```bash
npm install
spin build
spin up
```

Visit [http://localhost:3000](http://localhost:3000)

### Local database (alternative to Neon)

If you prefer to run Postgres locally via Docker:

```bash
docker compose up -d
```

Then set `DATABASE_URL` in `build.mjs` to:
```js
'process.env.DATABASE_URL': '"postgresql://postgres:postgres@localhost:5432/spin_counter"',
```

And update `spin.toml`:
```toml
allowed_outbound_hosts = ["https://*", "http://*", "postgres://localhost:5432"]
```

---

## Step 4 — Deploy to Akamai Wasm Functions

```bash
spin build
spin aka deploy
```

Your app will be live at:
```
https://YOUR_APP_NAME.fermyon.app
```

---

## What works on Spin

| Feature | Status |
|---|---|
| SSR / React Server Components | ✅ Works |
| Client-side React (CSR) | ✅ Works |
| API Routes | ✅ Works |
| Drizzle ORM + Postgres (Neon) | ✅ Works |
| Clerk Auth (server-side middleware) | ✅ Works |
| i18n (English / French) | ✅ Works |
| Dynamic routing `[slug]` | ✅ Works |
| ISR / `revalidate` | ❌ Not supported |
| `next/image` optimisation | ⚠️ Partial |
| Arcjet bot protection | ⚠️ Stubbed |

---

## Demo pages

| Route | What it shows |
|---|---|
| `/` | Home page (SSR) |
| `/counter` | Live DB read/write via Drizzle ORM + Neon |
| `/portfolio` | Static list with dynamic slug routing |
| `/portfolio/[0-5]` | Dynamic route rendered in WASM |
| `/sign-in` | Clerk authentication |
| `/sign-up` | Clerk registration |
| `/dashboard` | Protected route — redirects to `/sign-in` if not authenticated |
| `/fr/counter` | Same page in French — i18n SSR at the edge |

---

## Using Spin Interfaces

To add more Spin interfaces, install the corresponding packages:

| Interface | Package |
|---|---|
| Key-Value | `@spinframework/spin-kv` |
| LLM | `@spinframework/spin-llm` |
| MQTT | `@spinframework/spin-mqtt` |
| MySQL | `@spinframework/spin-mysql` |
| PostgreSQL | `@spinframework/spin-postgres` |
| Redis | `@spinframework/spin-redis` |
| SQLite | `@spinframework/spin-sqlite` |
| Variables | `@spinframework/spin-variables` |

---

## Debugging with StarlingMonkey (VS Code)

1. Install the [StarlingMonkey Debugger](https://marketplace.visualstudio.com/items?itemName=BytecodeAlliance.starlingmonkey-debugger) extension
2. Build with `npm run build:debug`
3. Uncomment `tcp://127.0.0.1:*` in `allowed_outbound_hosts` in `spin.toml`
4. Start the debugger in VS Code — restart for each HTTP call
