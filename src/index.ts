// Spin entry point for vinext App Router
// This file is bundled by esbuild and compiled to WASM via j2w.
// It imports the vinext production build output and serves requests.
// Static assets (JS, CSS, images) are served by Spin's static fileserver component.

// Import the vinext RSC server entry (produced by `vinext build`)
// @ts-expect-error - this is the vinext build output
import rscHandler from '../dist/server/index.js';

async function handleRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const {pathname} = url;

    // Delegate to the vinext RSC handler for all requests
    // (static assets are handled by the Spin static fileserver component)
    console.log('[spin] Delegating to RSC handler:', pathname);
    let resp: Response | undefined;
    if (typeof rscHandler === 'function') {
      resp = await rscHandler(request, null);
    } else if (rscHandler && typeof rscHandler.default === 'function') {
      resp = await rscHandler.default(request, null);
    } else if (rscHandler && typeof rscHandler.fetch === 'function') {
      resp = await rscHandler.fetch(request, {}, null);
    }

    if (resp) {
      console.log('[spin] RSC response:', resp.status);
      if (resp.status >= 400 && typeof resp.clone === 'function') {
        const body = await resp.clone().text();
        console.error('[spin] Error response body:', body.slice(0, 500));
      }
      return resp;
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('[spin] Request error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

//@ts-expect-error
// Signal end of init phase so fetch wrapper restores original behavior
declare let _initPhase: boolean;
_initPhase = false;

//@ts-expect-error
addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleRequest(event.request));
});
