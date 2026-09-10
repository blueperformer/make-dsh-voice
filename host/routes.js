/**
 * The plugin's HTTP surface: everything the browser half needs from the host.
 *
 * Routes rather than the typed remote-RPC machinery: a route is a plain Node
 * handler, so the plugin ships audio bytes and JSON without generating a wire
 * schema, and the browser half stays a hand-written bundle with no build step
 * beyond concatenation.
 *
 * Every route sits under `/dsh-voice/` — a prefix nothing else claims, so the
 * shipped SPA fallback and the `/api` gateway both stay out of the way.
 *
 * Two of these endpoints have real side effects (one spends API credits, one
 * deletes files), so they pass {@link sameOrigin} first: a browser attaches an
 * `Origin` header to any cross-site request, and rejecting a mismatch keeps a
 * random page in the user's browser from driving this plugin.
 * @module dsh-voice/routes
 */

import { existsSync, createReadStream } from 'node:fs'

/** Largest JSON request body accepted, in bytes. Texts are short; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 256 * 1024

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-voice'

/**
 * Whether a request comes from this server's own page.
 *
 * A missing `Origin` is allowed: same-origin `fetch` from the served page may
 * omit it, while a cross-site one always carries it.
 * @param req - the incoming request.
 * @returns whether the request may proceed.
 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Answer one request with JSON.
 * @param res - the response to own.
 * @param status - the HTTP status.
 * @param body - a JSON-serializable body.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Read and parse a JSON request body.
 * @param req - the incoming request.
 * @returns the parsed object, or undefined when absent, oversized, or malformed.
 */
function readJson(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => { resolve(undefined) })
  })
}

/**
 * Build this plugin's routes.
 * @param options - the collaborators each route needs.
 * @param options.store - the audio directory.
 * @param options.synth - the synthesizer.
 * @param options.bootClip - absolute path of the bundled boot clip, or undefined when absent.
 * @param options.openDir - reveals the audio directory in the OS file manager.
 * @param options.log - a diagnostics sink (never the response).
 * @returns the route registrations, in a stable order.
 */
export function voiceRoutes({ store, synth, bootClip, openDir, log }) {
  /** Descriptors for one clip, with the URL the browser should fetch it from. */
  const describe = clip => (clip === undefined ? null : {
    name: clip.name,
    bytes: clip.bytes,
    url: `${ROUTE_PREFIX}/audio?name=${encodeURIComponent(clip.name)}`,
  })

  return [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/latest`,
      async handler(req, res) {
        sendJson(res, 200, { ok: true, dir: store.dir(), clip: describe(store.latest()) })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/audio`,
      handler(req, res) {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = store.pathOf(url.searchParams.get('name') ?? '')
        if (path === undefined) {
          sendJson(res, 404, { ok: false, message: '语音文件不存在' })
          return
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' })
        const stream = createReadStream(path)
        stream.on('error', () => { res.destroy() })
        stream.pipe(res)
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/boot`,
      handler(req, res) {
        if (bootClip === undefined || !existsSync(bootClip)) {
          sendJson(res, 404, { ok: false, message: '未找到开机音文件 assets/boot.mp3' })
          return
        }
        // Served from disk rather than embedded in the client bundle, so
        // replacing the clip needs no rebuild.
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-cache' })
        const stream = createReadStream(bootClip)
        stream.on('error', () => { res.destroy() })
        stream.pipe(res)
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/speak`,
      async handler(req, res) {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: '跨站请求被拒绝' })
        const body = await readJson(req)
        if (body === undefined) return sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
        try {
          const clip = await synth.synthesize(body.text)
          sendJson(res, 200, { ok: true, clip: describe(clip) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`synthesize failed: ${message}`)
          sendJson(res, 500, { ok: false, message })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/open`,
      async handler(req, res) {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: '跨站请求被拒绝' })
        try {
          await openDir(store.ensure())
          sendJson(res, 200, { ok: true, dir: store.dir() })
        } catch (error) {
          sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/clear`,
      async handler(req, res) {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: '跨站请求被拒绝' })
        try {
          sendJson(res, 200, { ok: true, removed: store.clear() })
        } catch (error) {
          sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
