// Stub: @arcjet/next is not available in the Spin/WASM runtime.
// Arcjet loads WASM modules via fetch at init time, which StarlingMonkey prohibits.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

type ArcjetRule = Record<string, unknown>;

type ArcjetOptions = {
  key?: string;
  characteristics?: string[];
  rules?: ArcjetRule[];
}

type ArcjetDecision = {
  isDenied: () => boolean;
  reason: { type: string };
}

type ArcjetInstance = {
  withRule: (rule: ArcjetRule) => ArcjetInstance;
  protect: (req?: any) => Promise<ArcjetDecision>;
}

function createArcjet(_options: ArcjetOptions): ArcjetInstance {
  const instance: ArcjetInstance = {
    withRule: () => instance,
    protect: async () => ({ isDenied: () => false, reason: { type: 'ALLOW' } }),
  };
  return instance;
}

export function shield(_options?: any): ArcjetRule {
  return {};
}
export function detectBot(_options?: any): ArcjetRule {
  return {};
}
export function tokenBucket(_options?: any): ArcjetRule {
  return {};
}
export function fixedWindow(_options?: any): ArcjetRule {
  return {};
}
export function slidingWindow(_options?: any): ArcjetRule {
  return {};
}

export default createArcjet;
