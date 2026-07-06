// Stub: @sentry/nextjs is not available in the Spin/WASM runtime.
// Sentry requires Node.js APIs (net, http, fs) that don't exist in StarlingMonkey.
// To enable: provide a WASM-compatible Sentry transport or use edge-compatible SDK.

const noop = () => {};
const noopAsync = async () => {};

export function init() {}
export function captureException() {}
export function captureMessage() {}
export function captureEvent() {}
export function withScope(cb: (scope: any) => void) {
  cb({});
}
export function setUser() {}
export function setTag() {}
export function setExtra() {}
export function addBreadcrumb() {}
export function startSpan() {}
export function consoleLoggingIntegration() {
  return {};
}
export function replayIntegration() {
  return {};
}
export function browserTracingIntegration() {
  return {};
}
export function withSentryConfig(config: any) {
  return config;
}

export type NodeOptions = Record<string, unknown>;
export type EdgeOptions = Record<string, unknown>;

export default {
  init,
  captureException,
  captureMessage,
  captureEvent,
  withScope,
  setUser,
  setTag,
  setExtra,
  addBreadcrumb,
  startSpan,
  consoleLoggingIntegration,
  replayIntegration,
  browserTracingIntegration,
  withSentryConfig,
};
