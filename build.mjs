import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SpinEsbuildPlugin } from '@spinframework/build-tools/plugins/esbuild/index.js';
// build.mjs
// Three-phase build for Next.js App Router on Spin via vinext:
//   1. vinext build → dist/server/ (RSC entry + SSR) + dist/client/ (client bundles)
//   2. Collect client assets for static file serving
//   3. esbuild bundles everything into build/bundle.js for Spin's j2w
import { build } from 'esbuild';

// Phase 1: Run vinext build to produce RSC server entry + client bundles
console.log('[build] Phase 1: Running vinext build...');
try {
  execSync('npx vinext build', { stdio: 'inherit', cwd: process.cwd() });
} catch {
  console.error('[build] vinext build failed');
  process.exit(1);
}

// Phase 2: Skip — static assets are served by Spin's static fileserver component
console.log('[build] Phase 2: Skipped (static fileserver serves dist/client/ directly)');

// Ensure build directory exists
const buildDir = path.resolve('build');
fs.mkdirSync(buildDir, { recursive: true });

// Phase 3: Bundle for Spin using esbuild
console.log('[build] Phase 3: Bundling for Spin...');
const spinPlugin = await SpinEsbuildPlugin();

await build({
  entryPoints: ['./src/index.ts'],
  outfile: './build/bundle.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
  minify: false,
  plugins: [
    {
      name: 'polyfill-node-modules',
      setup(build) {
        // Redirect node:async_hooks to our polyfill
        build.onResolve({ filter: /^node:async_hooks$/ }, () => ({
          path: path.resolve('src/async-local-storage-polyfill.ts'),
        }));
        // Stub node:crypto → use Web Crypto API
        build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
          path: 'crypto-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /crypto-polyfill/, namespace: 'polyfill' }, () => ({
          contents: `
            export const webcrypto = globalThis.crypto;
            export const randomBytes = (size) => {
              const buf = new Uint8Array(size);
              webcrypto.getRandomValues(buf);
              return buf;
            };
            export const randomUUID = () => webcrypto.randomUUID();
            export const createHash = (algo) => {
              let data = new Uint8Array(0);
              return {
                update(input) {
                  const enc = typeof input === 'string' ? new TextEncoder().encode(input) : input;
                  const merged = new Uint8Array(data.length + enc.length);
                  merged.set(data);
                  merged.set(enc, data.length);
                  data = merged;
                  return this;
                },
                async digest(encoding) {
                  const hashBuffer = await webcrypto.subtle.digest(algo === 'md5' ? 'MD5' : 'SHA-256', data);
                  const hashArray = new Uint8Array(hashBuffer);
                  if (encoding === 'hex') return [...hashArray].map(b => b.toString(16).padStart(2, '0')).join('');
                  if (encoding === 'base64') return btoa(String.fromCharCode(...hashArray));
                  return hashArray;
                },
                // Sync version (fallback - not all algos supported)
                digestSync(encoding) { return '0'.repeat(64); }
              };
            };
            export const createHmac = (algo, key) => createHash(algo);
            export default { randomBytes, randomUUID, createHash, createHmac, webcrypto };
          `,
          loader: 'js',
        }));
        // Stub node:process
        build.onResolve({ filter: /^(node:)?process$/ }, () => ({
          path: 'process-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /process-polyfill/, namespace: 'polyfill' }, () => ({
          contents: `
            const process = {
              env: { NODE_ENV: 'production' },
              platform: 'wasm',
              version: 'v22.0.0',
              versions: {},
              cwd: () => '/',
              nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
            };
            export default process;
            export const env = process.env;
          `,
          loader: 'js',
        }));
        // Stub node:fs and fs
        build.onResolve({ filter: /^(node:)?fs(\/promises)?$/ }, () => ({
          path: 'fs-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /fs-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const readFileSync = () => { throw new Error('fs.readFileSync not available in Spin'); };
            export const writeFileSync = () => { throw new Error('fs.writeFileSync not available in Spin'); };
            export const existsSync = () => false;
            export const mkdirSync = () => {};
            export const readdirSync = () => [];
            export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
            export const readFile = async () => { throw new Error('fs.readFile not available in Spin'); };
            export const writeFile = async () => { throw new Error('fs.writeFile not available in Spin'); };
            export default { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, readFile, writeFile };
          `,
          loader: 'js',
        }));
        // Stub node:path and path
        build.onResolve({ filter: /^(node:)?path$/ }, () => ({
          path: 'path-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /path-polyfill/, namespace: 'polyfill' }, () => ({
          contents: [
            'const slashRe = new RegExp("/{2,}", "g");',
            'const trailingRe = new RegExp("/$", "");',
            'export const join = (...parts) => parts.filter(Boolean).join("/").replace(slashRe, "/");',
            'export const resolve = (...parts) => join(...parts);',
            'export const normalize = (p) => p.replace(slashRe, "/").replace(trailingRe, "") || "/";',
            'export const dirname = (p) => p.split("/").slice(0, -1).join("/") || "/";',
            'export const basename = (p, ext) => { const b = p.split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };',
            'export const extname = (p) => { const i = p.lastIndexOf("."); return i > 0 ? p.slice(i) : ""; };',
            'export const relative = (from, to) => to;',
            'export const isAbsolute = (p) => p.startsWith("/");',
            'export const sep = "/";',
            'export const posix = { join, resolve, normalize, dirname, basename, extname, relative, isAbsolute, sep };',
            'export default { join, resolve, normalize, dirname, basename, extname, relative, isAbsolute, sep, posix };',
          ].join('\n'),
          loader: 'js',
        }));
        // Stub node:url
        build.onResolve({ filter: /^(node:)?url$/ }, () => ({
          path: 'url-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /url-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const URL = globalThis.URL;
            export const URLSearchParams = globalThis.URLSearchParams;
            export const fileURLToPath = (u) => String(u).replace(/^file:\\/\\//, '');
            export const pathToFileURL = (p) => 'file://' + p;
            export default { URL, URLSearchParams, fileURLToPath, pathToFileURL };
          `,
          loader: 'js',
        }));
        // Stub node:tty
        build.onResolve({ filter: /^(node:)?tty$/ }, () => ({
          path: 'tty-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /tty-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const isatty = () => false;
            export class ReadStream {}
            export class WriteStream {}
            export default { isatty, ReadStream, WriteStream };
          `,
          loader: 'js',
        }));
        // Stub node:module — only createRequire is needed at runtime; all built-in
        // modules are resolved statically by esbuild via the individual stubs above.
        build.onResolve({ filter: /^(node:)?module$/ }, () => ({
          path: 'module-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /module-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            const _builtins = ["fs","path","crypto","os","events","stream","util","url","buffer","async_hooks","tty","net","http","https","zlib","dns","module","worker_threads","child_process","diagnostics_channel","readline","inspector"];
            export const builtinModules = _builtins;
            export const isBuiltin = (name) => _builtins.includes(name.replace("node:", ""));
            export const createRequire = () => (id) => ({});
            export default { createRequire, builtinModules, isBuiltin };
          `,
          loader: 'js',
        }));
        // Stub node:util
        build.onResolve({ filter: /^(node:)?util$/ }, () => ({
          path: 'util-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /util-polyfill/, namespace: 'polyfill' }, () => ({
          contents: `
            export const promisify = (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (err, result) => err ? reject(err) : resolve(result)));
            export const inspect = (obj) => JSON.stringify(obj, null, 2);
            export const TextEncoder = globalThis.TextEncoder;
            export const TextDecoder = globalThis.TextDecoder;
            export const types = { isProxy: () => false, isTypedArray: (v) => ArrayBuffer.isView(v) };
            export default { promisify, inspect, TextEncoder, TextDecoder, types };
          `,
          loader: 'js',
        }));
        // Stub node:zlib
        build.onResolve({ filter: /^(node:)?zlib$/ }, () => ({
          path: 'zlib-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /zlib-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const gzipSync = (buf) => buf;
            export const gunzipSync = (buf) => buf;
            export const deflateSync = (buf) => buf;
            export const inflateSync = (buf) => buf;
            export const createGzip = () => ({ pipe: () => {} });
            export default { gzipSync, gunzipSync, deflateSync, inflateSync, createGzip };
          `,
          loader: 'js',
        }));
        // Stub node:http, node:https, node:http2
        const httpStub = `
          export const createServer = () => ({ listen: () => {}, on: () => {} });
          export const request = () => ({ on: () => {}, end: () => {} });
          export const get = request;
          export const Agent = class Agent {};
          export const globalAgent = new Agent();
          export default { createServer, request, get, Agent, globalAgent };
        `;
        build.onResolve({ filter: /^(node:)?https?2?$/ }, () => ({
          path: 'http-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /http-stub/, namespace: 'polyfill' }, () => ({
          contents: httpStub,
          loader: 'js',
        }));
        // Stub node:net, node:tls, node:dns
        build.onResolve({ filter: /^(node:)?(net|tls|dns)$/ }, () => ({
          path: 'net-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /net-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const connect = () => ({ on: () => {}, write: () => {}, end: () => {} });
            export const createConnection = connect;
            export const Socket = class Socket {};
            export default { connect, createConnection, Socket };
          `,
          loader: 'js',
        }));
        // Stub node:events
        build.onResolve({ filter: /^(node:)?events$/ }, () => ({
          path: 'events-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /events-polyfill/, namespace: 'polyfill' }, () => ({
          contents: `
            class EventEmitter {
              constructor() { this._events = {}; }
              on(event, fn) { (this._events[event] = this._events[event] || []).push(fn); return this; }
              once(event, fn) { const wrapped = (...args) => { this.off(event, wrapped); fn(...args); }; return this.on(event, wrapped); }
              off(event, fn) { const evts = this._events[event]; if (evts) this._events[event] = evts.filter(f => f !== fn); return this; }
              emit(event, ...args) { const evts = this._events[event]; if (evts) evts.forEach(fn => fn(...args)); return !!evts; }
              removeListener(event, fn) { return this.off(event, fn); }
              removeAllListeners(event) { if (event) delete this._events[event]; else this._events = {}; return this; }
              listeners(event) { return this._events[event] || []; }
              listenerCount(event) { return this.listeners(event).length; }
              addListener(event, fn) { return this.on(event, fn); }
              setMaxListeners() { return this; }
              getMaxListeners() { return 10; }
            }
            export { EventEmitter };
            export default EventEmitter;
          `,
          loader: 'js',
        }));
        // Stub node:os
        build.onResolve({ filter: /^(node:)?os$/ }, () => ({
          path: 'os-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /os-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const platform = () => 'wasm';
            export const hostname = () => 'spin';
            export const arch = () => 'wasm32';
            export const cpus = () => [{ model: 'wasm' }];
            export const tmpdir = () => '/tmp';
            export const homedir = () => '/';
            export const freemem = () => 0;
            export const totalmem = () => 0;
            export default { platform, hostname, arch, cpus, tmpdir, homedir, freemem, totalmem };
          `,
          loader: 'js',
        }));
        // Stub node:stream
        build.onResolve({ filter: /^(node:)?stream(\/.*)?$/ }, () => ({
          path: 'stream-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /stream-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export class Readable { pipe() { return this; } on() { return this; } read() { return null; } }
            export class Writable { write() {} end() {} on() { return this; } }
            export class Transform extends Readable { constructor() { super(); } }
            export class Duplex extends Readable { write() {} end() {} }
            export class PassThrough extends Transform {}
            export const pipeline = (...args) => { const cb = args.pop(); cb(null); };
            export const finished = (stream, cb) => cb(null);
            export default { Readable, Writable, Transform, Duplex, PassThrough, pipeline, finished };
          `,
          loader: 'js',
        }));
        // Stub node:worker_threads
        build.onResolve({ filter: /^(node:)?worker_threads$/ }, () => ({
          path: 'worker-threads-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /worker-threads-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const isMainThread = true;
            export const parentPort = null;
            export const workerData = null;
            export class Worker { constructor() { throw new Error('Workers not available in Spin'); } }
            export default { isMainThread, parentPort, workerData, Worker };
          `,
          loader: 'js',
        }));
        // Stub node:child_process
        build.onResolve({ filter: /^(node:)?child_process$/ }, () => ({
          path: 'child-process-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /child-process-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const exec = () => { throw new Error('child_process not available in Spin'); };
            export const execSync = exec;
            export const spawn = exec;
            export const fork = exec;
            export default { exec, execSync, spawn, fork };
          `,
          loader: 'js',
        }));
        // Stub node:diagnostics_channel
        build.onResolve({ filter: /^(node:)?diagnostics_channel$/ }, () => ({
          path: 'diagnostics-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /diagnostics-stub/, namespace: 'polyfill' }, () => ({
          contents: `
            export const channel = () => ({ subscribe: () => {}, unsubscribe: () => {}, publish: () => {} });
            export const hasSubscribers = () => false;
            export class Channel { subscribe() {} unsubscribe() {} publish() {} get hasSubscribers() { return false; } }
            export default { channel, hasSubscribers, Channel };
          `,
          loader: 'js',
        }));
        // Stub node:buffer
        build.onResolve({ filter: /^(node:)?buffer$/ }, () => ({
          path: 'buffer-polyfill',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /buffer-polyfill/, namespace: 'polyfill' }, () => ({
          contents: `
            const Buffer = globalThis.Buffer || class Buffer extends Uint8Array {
              static from(data, encoding) {
                if (typeof data === 'string') {
                  if (encoding === 'base64') {
                    const str = atob(data);
                    const arr = new Uint8Array(str.length);
                    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
                    return arr;
                  }
                  return new TextEncoder().encode(data);
                }
                return new Uint8Array(data);
              }
              static alloc(size) { return new Uint8Array(size); }
              static allocUnsafe(size) { return new Uint8Array(size); }
              static isBuffer(obj) { return obj instanceof Uint8Array; }
              toString(encoding) {
                if (encoding === 'base64') return btoa(String.fromCharCode(...this));
                if (encoding === 'hex') return [...this].map(b => b.toString(16).padStart(2, '0')).join('');
                return new TextDecoder().decode(this);
              }
            };
            export { Buffer };
            export default { Buffer };
          `,
          loader: 'js',
        }));
        // Stub node:readline
        build.onResolve({ filter: /^(node:)?readline$/ }, () => ({
          path: 'readline-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /readline-stub/, namespace: 'polyfill' }, () => ({
          contents: `export const createInterface = () => ({ on: () => {}, close: () => {} }); export default { createInterface };`,
          loader: 'js',
        }));
        // Stub node:inspector
        build.onResolve({ filter: /^(node:)?inspector$/ }, () => ({
          path: 'inspector-stub',
          namespace: 'polyfill',
        }));
        build.onLoad({ filter: /inspector-stub/, namespace: 'polyfill' }, () => ({
          contents: `export const open = () => {}; export const close = () => {}; export const url = () => undefined; export const Session = class {}; export default { open, close, url, Session };`,
          loader: 'js',
        }));
        // Resolve pg → Spin Postgres adapter
        build.onResolve({ filter: /^pg$/ }, () => ({
          path: path.resolve('src/spin-pg-adapter.ts'),
        }));
        // Keep Spin WIT imports external (resolved by j2w at componentize time)
        build.onResolve({ filter: /^fermyon:/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
    spinPlugin,
  ],
  logLevel: 'info',
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
  },
  resolveExtensions: ['.ts', '.tsx', '.js', '.mjs'],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_RUNTIME': '"edge"',
    'process.env.CLERK_SECRET_KEY': '"your_clerk_secret_key"',
    'process.env.DATABASE_URL': '"your_database_url"',
    'process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': '"your_clerk_publishable_key"',
    'process.env.NEXT_PUBLIC_APP_URL': '"http://localhost:3000"',
    'process.env.NEXT_PUBLIC_LOGGING_LEVEL': '"info"',
    'process.env.ARCJET_KEY': 'undefined',
    'process.env.NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN': 'undefined',
    'process.env.NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST': 'undefined',
    'process.env.NEXT_PUBLIC_POSTHOG_KEY': 'undefined',
    'process.env.NEXT_PUBLIC_POSTHOG_HOST': 'undefined',
    'import.meta.url': '"http://next-boilerplate.localhost/"',
  },
  banner: {
    js: [
      '// Global polyfills for StarlingMonkey (SpiderMonkey-based)',
      '{ const _ce = console.error; console.error = (...a) => { console.log("[ERR]", ...a); _ce.apply(console, a); }; }',
      'if (!Error.captureStackTrace) Error.captureStackTrace = function(obj, fn) { obj.stack = new Error().stack; };',
      'if (typeof process === "undefined") { globalThis.process = { env: { NODE_ENV: "production" }, platform: "wasm", version: "v22.0.0", versions: { node: "22.0.0" }, argv: ["/bin/node", "/app/server.js"], cwd: () => "/", nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)), stderr: { write: () => {} }, stdout: { write: () => {} } }; }',
      'if (typeof Buffer === "undefined") { globalThis.Buffer = { from: (d, e) => typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d), alloc: (n) => new Uint8Array(n), allocUnsafe: (n) => new Uint8Array(n), isBuffer: () => false, concat: (bufs) => { const r = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let o = 0; bufs.forEach(b => { r.set(b, o); o += b.length; }); return r; } }; }',
      'if (typeof setImmediate === "undefined") globalThis.setImmediate = (fn, ...args) => queueMicrotask(() => fn(...args));',
      'if (typeof clearImmediate === "undefined") globalThis.clearImmediate = () => {};',
      'if (typeof global === "undefined") globalThis.global = globalThis;',
      'if (typeof WebAssembly === "undefined") { globalThis.WebAssembly = { compile: () => Promise.reject(new Error("WebAssembly not available")), instantiate: () => Promise.reject(new Error("WebAssembly not available")), Module: class {}, Instance: class {} }; }',
      // Intl polyfill: StarlingMonkey doesn't include Intl
      `if (typeof Intl === "undefined") {
        function _intlCtor(impl) { return function F(...args) { return (this instanceof F) ? impl.apply(this, args) : new F(...args); }; }
        const _DTF = _intlCtor(function(l, o) { this.format = (d) => d instanceof Date ? d.toISOString() : String(d ?? ""); this.formatToParts = () => []; this.resolvedOptions = () => ({ locale: l || "en", timeZone: "UTC", calendar: "gregory" }); });
        const _NF = _intlCtor(function(l, o) { this.format = (n) => String(n); this.formatToParts = (n) => [{ type: "integer", value: String(n) }]; this.resolvedOptions = () => ({ locale: l || "en" }); });
        const _PR = _intlCtor(function(l, o) { this.select = (n) => n === 1 ? "one" : "other"; this.resolvedOptions = () => ({ locale: l || "en" }); });
        const _RTF = _intlCtor(function(l, o) { this.format = (v, u) => v + " " + u + (Math.abs(v) !== 1 ? "s" : "") + (v < 0 ? " ago" : " from now"); this.formatToParts = () => []; this.resolvedOptions = () => ({ locale: l || "en" }); });
        const _DN = _intlCtor(function(l, o) { this.of = (code) => code; this.resolvedOptions = () => ({ locale: l || "en" }); });
        const _LF = _intlCtor(function(l, o) { this.format = (list) => Array.from(list).join(", "); this.formatToParts = () => []; this.resolvedOptions = () => ({ locale: l || "en" }); });
        const _Col = _intlCtor(function(l, o) { this.compare = (a, b) => a < b ? -1 : a > b ? 1 : 0; this.resolvedOptions = () => ({ locale: l || "en" }); });
        function _Locale(tag) { if (!(this instanceof _Locale)) return new _Locale(tag); this.baseName = String(tag); this.language = String(tag)?.split("-")[0] || String(tag); this.region = String(tag)?.split("-")[1]; this.toString = () => String(tag); }
        globalThis.Intl = {
          getCanonicalLocales: (locales) => (Array.isArray(locales) ? locales : [locales]).filter(Boolean).map(String),
          Locale: _Locale,
          DateTimeFormat: _DTF,
          NumberFormat: _NF,
          PluralRules: _PR,
          RelativeTimeFormat: _RTF,
          DisplayNames: _DN,
          ListFormat: _LF,
          Collator: _Col,
        };
      }`,
      '// Wrap fetch to handle initialization-time calls (Arcjet WASM loading)',
      'let _initPhase = true; const _origFetch = globalThis.fetch;',
      'globalThis.fetch = function(...args) { if (_initPhase) { return Promise.resolve(new Response(new ArrayBuffer(0), { status: 200 })); } return _origFetch.apply(this, args); };',
    ].join('\n'),
  },
  external: [],
  sourceRoot: path.resolve(process.cwd(), 'src'),
});

console.log('[build] Build complete!');

// Post-build: patch dynamic RegExp using Unicode property escapes (\p{...})
// StarlingMonkey's SpiderMonkey doesn't support \p{} in `new RegExp()` at runtime.
// This comes from @formatjs/icu-messageformat-parser used by next-intl.
let bundleContent = fs.readFileSync('build/bundle.js', 'utf-8');
const regexPatches =
  bundleContent.split(String.raw`new RegExp("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu")`)
    .length - 1;
bundleContent = bundleContent.replaceAll(
  String.raw`new RegExp("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu")`,
  // Equivalent: match non-whitespace, non-ASCII-punctuation chars (covers ICU identifiers)
  String.raw`new RegExp("([^\\s!-/:-@\\[-\x60{-~]*)", "y")`,
);
// Patch renderErrorBoundaryPage to log errors
bundleContent = bundleContent.replace(
  'async function renderErrorBoundaryPage(route, error,',
  'async function renderErrorBoundaryPage(route, error, ...rest) { console.log("[vinext:error]", error?.message || error, error?.stack || ""); return _renderErrorBoundaryPage(route, error, ...rest); }\nasync function _renderErrorBoundaryPage(route, error,',
);
// Patch RSC error handler to log original errors before production sanitization
bundleContent = bundleContent.replace(
  'function createRscOnErrorHandler$1(options) {',
  'function createRscOnErrorHandler$1(options) { const _origFactory = createRscOnErrorHandler$1_orig; return _origFactory(options); }\nfunction createRscOnErrorHandler$1_orig(options) {',
);
bundleContent = bundleContent.replace(
  'if (nodeEnv === "production" && error) return errorDigest(',
  'if (error) console.log("[rsc:error]", error?.message || String(error), error?.stack || ""); if (nodeEnv === "production" && error) return errorDigest(',
);
// Patch __require2("react-dom") to return the actual react-dom module
// The React Flight Client uses createRequire to load react-dom, but our stub returns {}
bundleContent = bundleContent.replace(
  'var ReactDOM$1 = __require2("react-dom")',
  'var ReactDOM$1 = require_react_dom()',
);
// Patch middleware matcher to exclude _vinext paths (image optimization endpoint)
// The next-intl middleware adds locale prefix to all paths, breaking /_vinext/image
{
  const oldMatcher =
    `config$1 = { matcher: "/((?!_next|_vercel|monitoring|.*${  String.raw`\\.`  }.*).*)"}`;
  const newMatcher =
    `config$1 = { matcher: "/((?!_next|_vercel|_vinext|monitoring|.*${ 
    String.raw`\\.` 
    }.*).*)"}`;
  if (bundleContent.includes(oldMatcher)) {
    bundleContent = bundleContent.replace(oldMatcher, newMatcher);
    console.log('[build] Patched middleware matcher to exclude _vinext paths');
  } else {
    // Try the exact format from the bundle
    const oldMatcher2 = String.raw`"/((?!_next|_vercel|monitoring|.*\\..*).*)"`;
    const newMatcher2 = String.raw`"/((?!_next|_vercel|_vinext|monitoring|.*\\..*).*)"`;
    if (bundleContent.includes(oldMatcher2)) {
      bundleContent = bundleContent.replace(oldMatcher2, newMatcher2);
      console.log('[build] Patched middleware matcher to exclude _vinext paths');
    } else {
      console.warn('[build] WARNING: Could not find middleware matcher to patch');
    }
  }
}
fs.writeFileSync('build/bundle.js', bundleContent);
console.log(`[build] Patched ${regexPatches} Unicode property escape regex(es)`);
