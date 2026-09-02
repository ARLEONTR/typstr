import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import net from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { Request, Response } from 'express'
import type { ProjectWorkspace } from './projectWorkspace.js'
import { createMirroredWorkspace, resolveWorkspacePath, syncMirroredWorkspace } from './workspaceMirror.js'

// Injected into every HTML page served by the tinymist proxy.
const WS_REDIRECT_SCRIPT = '<script>' +
'(function(){' +
  'var _consoleWarn = console.warn;' +
  'console.warn = function(){' +
    'var first = arguments.length > 0 ? String(arguments[0]) : "";' +
    'if (first.indexOf("using deprecated parameters for the initialization function; pass a single object instead") !== -1) return;' +
    'return _consoleWarn.apply(console, arguments);' +
  '};' +
  'var proxyBase = location.pathname.replace(/\\/+$/, "");' +
  'var localHttpPattern = /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?(\\/|$)/;' +
  'var localWsPattern   = /^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?(\\/.*)?$/;' +
  'function rewriteHttpUrl(url) {' +
    'if (!url || !localHttpPattern.test(url)) return url;' +
    'try { return proxyBase + new URL(url).pathname + new URL(url).search; } catch(_) { return url; }' +
  '}' +
  'var _fetch = window.fetch;' +
  'window.fetch = function(input, init) {' +
    'if (typeof input === "string") {' +
      'input = rewriteHttpUrl(input);' +
    '} else if (input instanceof URL) {' +
      'input = new URL(rewriteHttpUrl(input.href), location.href);' +
    '} else if (input && typeof input.url === "string") {' +
      'var rewritten = rewriteHttpUrl(input.url);' +
      'if (rewritten !== input.url) input = new Request(rewritten, input);' +
    '}' +
    'return _fetch.call(this, input, init);' +
  '};' +
  'var _xhrOpen = XMLHttpRequest.prototype.open;' +
  'XMLHttpRequest.prototype.open = function(method, url) {' +
    'var args = Array.prototype.slice.call(arguments);' +
    'if (typeof url === "string") args[1] = rewriteHttpUrl(url);' +
    'return _xhrOpen.apply(this, args);' +
  '};' +
  'var _WS = window.WebSocket;' +
  'function PatchedWS(arg1, arg2) {' +
    'var wsProto = location.protocol === "https:" ? "wss:" : "ws:";' +
    'var wsHost = location.host;' +
    'var root = wsProto + "//" + location.host + "/";' +
    'var backendRoot = wsProto + "//" + wsHost + "/";' +
    'var proxyWsUrl = wsProto + "//" + wsHost + location.pathname;' +
    'var url, protocols, options;' +
    'if (typeof arg1 === "object" && arg1 !== null && !Array.isArray(arg1) && (arg1.url || typeof arg1.url !== "undefined")) {' +
      'url = arg1.url;' +
      'protocols = arg1.protocols;' +
      'options = arg1;' +
    '} else {' +
      'url = arg1;' +
      'protocols = arg2;' +
    '}' +
    'if (url === root || url === backendRoot || url === "/" || localWsPattern.test(url)) {' +
      'url = proxyWsUrl;' +
    '}' +
    'var ws;' +
    'if (options) {' +
      'ws = new _WS(Object.assign({}, options, { url: url, protocols: protocols }));' +
    '} else {' +
      'ws = protocols !== undefined ? new _WS(url, protocols) : new _WS(url);' +
    '}' +
    'lastWs = ws;' +
    'return ws;' +
  '}' +
  'PatchedWS.CONNECTING = _WS.CONNECTING;' +
  'PatchedWS.OPEN = _WS.OPEN;' +
  'PatchedWS.CLOSING = _WS.CLOSING;' +
  'PatchedWS.CLOSED = _WS.CLOSED;' +
  'PatchedWS.prototype = _WS.prototype;' +
  'window.WebSocket = PatchedWS;' +
  'function findTypstAncestor(el, cls) {' +
    'while (el && el.parentElement) {' +
      'el = el.parentElement;' +
      'if (el.classList && el.classList.contains(cls)) return el;' +
    '}' +
    'return null;' +
  '}' +
  'if (typeof window.handleTypstLocation !== "function") {' +
    'window.handleTypstLocation = function(elem, pageNumber, x, y) {' +
      'var docRoot = findTypstAncestor(elem, "typst-doc");' +
      'if (!docRoot || !docRoot.children) return;' +
      'var nthPage = 0;' +
      'for (var i = 0; i < docRoot.children.length; i++) {' +
        'var child = docRoot.children[i];' +
        'if (String(child.tagName).toLowerCase() === "g") nthPage++;' +
        'if (nthPage == pageNumber) {' +
          'var dataWidth = Number(child.getAttribute("data-page-width") || 0);' +
          'var dataHeight = Number(child.getAttribute("data-page-height") || 0);' +
          'if (!dataWidth || !dataHeight) return;' +
          'var rect = child.getBoundingClientRect();' +
          'var base = (document.body || document.documentElement).getBoundingClientRect();' +
          'var xInner = Math.max(0, x / dataWidth - 0.05) * rect.width;' +
          'var yInner = Math.max(0, y / dataHeight - 0.05) * rect.height;' +
          'var xFix = (x / dataWidth) * rect.width - xInner;' +
          'var yFix = (y / dataHeight) * rect.height - yInner;' +
          'window.scrollTo(rect.left - base.left + xInner, rect.top - base.top + yInner);' +
          'return { left: rect.left - base.left + xInner + xFix, top: rect.top - base.top + yInner + yFix };' +
        '}' +
      '}' +
    '};' +
  '}' +
  // Forward right-click events to the parent so it can show a context menu.
  // selectedText is the current window selection at the time of the right-click.
  'document.addEventListener("contextmenu", function(e) {' +
    'var sel = window.getSelection ? window.getSelection().toString() : "";' +
    'window.parent.postMessage({ type: "typstr:contextmenu", selectedText: sel, x: e.clientX, y: e.clientY }, "*");' +
    'e.preventDefault();' +
  '});' +
'})();' +
'</script>'

export interface TypstPreviewSessionDescriptor {
  sessionId: string
  proxyPath: string
  entryAbsPath: string | null
  workspaceDir: string | null
  engine: 'tinymist' | 'fallback'
  ready: boolean
  detail: string | null
}

type LogListener = (line: string) => void

type TypstPreviewSession = {
  sessionId: string
  baseSessionId: string
  projectId: string
  entryPath: string
  workspaceDir: string
  port: number
  controlPort: number
  process: ReturnType<typeof spawn> | null
  ready: boolean
  detail: string | null
  logBuffer: string[]
  listeners: Set<LogListener>
  lastTouchedAt: number
  workspaceHash: string
}

export const sessions = new Map<string, TypstPreviewSession>()
const SESSION_TTL_MS = 15 * 60 * 1000
const tinymistExecutable = process.env.TINYMIST_BIN ?? 'tinymist'

export async function ensureTypstPreviewSession(input: {
  projectId: string
  sessionId: string
  workspace: ProjectWorkspace
}): Promise<TypstPreviewSessionDescriptor> {
  console.log('[Tinymist Preview] Initializing session for project:', input.projectId, 'Session ID:', input.sessionId);
  cleanupExpiredSessions()
  console.log('[Tinymist Preview] Existing sessions:', Array.from(sessions.keys()));

  if (!tinymistExecutable) {
    return {
      sessionId: input.sessionId,
      proxyPath: '',
      entryAbsPath: null,
      workspaceDir: null,
      engine: 'fallback',
      ready: false,
      detail: 'Tinymist is not configured on the backend.',
    }
  }

  const nextWorkspaceHash = getWorkspaceHash(input.workspace)

  const stableSessionId = input.sessionId
  let session = sessions.get(stableSessionId)
  if (!session) {
    try {
      const mirrored = createMirroredWorkspace(input.workspace, 'typstr-tinymist-preview-')
      const port = await allocatePort();
      const controlPort = await allocatePort();
      session = {
        sessionId: stableSessionId,
        baseSessionId: input.sessionId,
        projectId: input.projectId,
        entryPath: input.workspace.entryPath,
        workspaceDir: mirrored.dir,
        port,
        controlPort,
        process: null,
        ready: false,
        detail: null,
        logBuffer: [],
        listeners: new Set(),
        lastTouchedAt: Date.now(),
        workspaceHash: nextWorkspaceHash,
      }
      sessions.set(stableSessionId, session)
      syncMirroredWorkspace(session.workspaceDir, input.workspace.files)
    } catch (e) {
      console.error('[Tinymist Preview] Failed to init session:', e);
      throw e;
    }
  } else {
    session.entryPath = input.workspace.entryPath
    session.lastTouchedAt = Date.now()
    if (session.workspaceHash !== nextWorkspaceHash) {
      syncMirroredWorkspace(session.workspaceDir, input.workspace.files)
      session.workspaceHash = nextWorkspaceHash
    }
  }

  if (!session.process) {
    const entryFilePath = resolveWorkspacePath(session.workspaceDir, session.entryPath)
    const proc = spawn(
      tinymistExecutable,
      [
        'preview',
        entryFilePath,
        '--no-open',
        `--data-plane-host=127.0.0.1:${session.port}`,
        `--control-plane-host=127.0.0.1:${session.controlPort}`,
      ],
      {
        cwd: session.workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildTinymistChildEnv(),
      },
    )


    const s = session
    s.process = proc

    const pushLog = (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        s.detail = trimmed
        s.logBuffer.push(trimmed)
        if (s.logBuffer.length > 500) s.logBuffer.shift()
        for (const listener of s.listeners) listener(trimmed)
      }
    }

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', pushLog)
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', pushLog)
    proc.on('exit', (code, signal) => {
      s.process = null
      s.ready = false
      if (code !== 0) {
        const msg = 'Tinymist preview exited' + (code !== null ? ' with code ' + code : '') + (signal ? ' (' + signal + ')' : '');
        s.detail = msg
        s.logBuffer.push(msg)
        for (const listener of s.listeners) listener(msg)
      }
    })
    proc.on('error', (error) => {
      s.detail = error.message
      s.ready = false
      s.process = null
      s.logBuffer.push(error.message)
      for (const listener of s.listeners) listener(error.message)
    })
  }

  const [dataReady, controlReady] = await Promise.all([
    waitForServer(session.port, 6_000),
    waitForServer(session.controlPort, 6_000),
  ])
  const ready = dataReady && controlReady
  session.ready = ready
  if (!ready && !session.detail) {
    session.detail = dataReady
      ? 'Tinymist control-plane did not become ready in time.'
      : 'Tinymist preview did not become ready in time.'
  }

  return {
    sessionId: session.sessionId,
    proxyPath: '/api/projects/' + input.projectId + '/tinymist-preview/' + encodeURIComponent(session.sessionId),
    entryAbsPath: ready ? resolveWorkspacePath(session.workspaceDir, session.entryPath) : null,
    workspaceDir: ready ? session.workspaceDir : null,
    engine: ready ? 'tinymist' : 'fallback',
    ready,
    detail: session.detail,
  }
}

function buildTinymistChildEnv(): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: process.env.HOME ?? '/tmp',
  }
  delete childEnv.PORT
  return childEnv
}

export async function proxyTypstPreviewRequest(req: Request, res: Response): Promise<void> {
  const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId
  console.log('Proxying session ID:', sessionId, 'Available sessions:', [...sessions.keys()]);

  const session = sessions.get(sessionId)
  if (!session) {
    res.status(404).type('html').send(
      '<!doctype html><html><body><script>' +
      'window.parent.postMessage({type:"typstr:session-lost"},"*")' +
      '</script></body></html>',
    )
    return
  }

  // Same as the WS proxy: if `session.ready` is false but tinymist's port is
  // alive, treat the session as ready and refresh the flag. Otherwise the
  // preview can permanently 404 after a single tinymist hiccup.
  if (!session.ready) {
    const portAlive = await waitForServer(session.port, 1_500)
    if (!portAlive) {
      res.status(404).type('html').send(
        '<!doctype html><html><body><script>' +
        'window.parent.postMessage({type:"typstr:session-lost"},"*")' +
        '</script></body></html>',
      )
      return
    }
    session.ready = true
  }

  session.lastTouchedAt = Date.now()
  const wildcard = normalizeRouteParam(req.params['path']).replace(/^\/+/, '')
  const targetUrl = new URL('http://127.0.0.1:' + session.port + '/' + wildcard)
  const queryIndex = req.originalUrl.indexOf('?')
  if (queryIndex !== -1) {
    targetUrl.search = req.originalUrl.slice(queryIndex)
  }

  let response: globalThis.Response
  try {
    response = await fetchPreviewResponse(targetUrl, req)
  } catch (error) {
    const recovered = await tryRecoverPreviewFetch(session, targetUrl, req)
    if (recovered) {
      response = recovered
    } else {
      res.status(502).json({ error: 'Tinymist preview unavailable.' })
      return
    }
  }

  // Clear restrictive headers and set a comprehensive CSP to allow preview functionality and framing.
  res.removeHeader('Content-Security-Policy')
  res.removeHeader('X-Frame-Options')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' ws: wss: data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'self' http://localhost:8989 http://localhost:5173 http://localhost:3000;"
  )

  res.status(response.status)
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-security-policy' && key.toLowerCase() !== 'x-frame-options') {
      res.setHeader(key, value)
    }
  })

  if (!response.body) {
    res.end()
    return
  }

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    let html = Buffer.from(arrayBuffer).toString('utf-8')
    html = html.includes('</head>')
      ? html.replace('</head>', WS_REDIRECT_SCRIPT + '</head>')
      : WS_REDIRECT_SCRIPT + html
    res.removeHeader('content-length')
    res.send(html)
  } else {
    res.send(Buffer.from(arrayBuffer))
  }
}

function normalizeRouteParam(value: unknown): string {
  if (Array.isArray(value)) return value.join('/')
  return typeof value === 'string' ? value : ''
}

async function fetchPreviewResponse(targetUrl: URL, req: Request): Promise<globalThis.Response> {
  return await fetch(targetUrl, {
    method: req.method,
    headers: forwardHeaders(req),
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
  } as RequestInit)
}

async function tryRecoverPreviewFetch(session: TypstPreviewSession, targetUrl: URL, req: Request): Promise<globalThis.Response | null> {
  if (!(await canConnect(session.port))) {
    if (!(await waitForServer(session.port, 1_500))) return null
  }
  try { return await fetchPreviewResponse(targetUrl, req) } catch { return null }
}

export async function proxyTypstPreviewWebSocket(req: IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> {
  console.log('[Tinymist Preview] Incoming request URL:', req.url);
  const match = req.url?.match(/\/tinymist-preview\/([^/?]+)(\/control)?/)
  if (!match) {
    console.log('[Tinymist Preview] No match for URL:', req.url);
    sendUpgradeErrorResponse(socket, 404, 'Tinymist preview websocket route not found.')
    return
  }

  const sessionId = decodeURIComponent(match[1]);
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`[Tinymist Preview] No session found for sessionId: ${sessionId}. Available:`, Array.from(sessions.keys()));
    sendUpgradeErrorResponse(socket, 404, 'Tinymist preview session not found.')
    return
  }

  // `session.ready` only flips true on the first successful boot; once tinymist
  // crashes or restarts, it stays false until ensureTypstPreviewSession is
  // called again. But the WS handler runs without that re-entry, so a brief
  // tinymist hiccup would otherwise wedge the preview into permanent 503s.
  // Probe the target port directly — if it accepts connections, the session
  // is functionally ready, so refresh the flag and let the WS through.
  const targetPort = Boolean(match[2]) ? session.controlPort : session.port
  if (!session.ready) {
    const portAlive = await waitForServer(targetPort, 1_500)
    if (!portAlive) {
      console.error(`[Tinymist Preview] Session not ready for sessionId: ${sessionId}. Detail:`, session.detail);
      sendUpgradeErrorResponse(socket, 503, 'Tinymist preview session is not ready.')
      return
    }
    session.ready = true
  }

  session.lastTouchedAt = Date.now()
  const proxySocket = net.createConnection({ host: '127.0.0.1', port: targetPort })

  proxySocket.on('connect', () => {
    console.log('[Tinymist Preview] Proxy connected to target port:', targetPort, 'for sessionId:', sessionId);
    const headerLines = Object.entries(req.headers).filter(([key]) => !['host', 'origin'].includes(key.toLowerCase())).map(([key, val]) => key + ': ' + val)
    proxySocket.write('GET / HTTP/1.1\r\nhost: 127.0.0.1:' + targetPort + '\r\norigin: http://127.0.0.1:' + targetPort + '\r\n' + headerLines.join('\r\n') + '\r\n\r\n')
    if (head.length > 0) proxySocket.write(head)
    socket.pipe(proxySocket).pipe(socket)
  });
  proxySocket.on('error', (err) => {
    console.error('[Tinymist Preview] Proxy socket error:', err, 'for sessionId:', sessionId);
    sendUpgradeErrorResponse(socket, 502, 'Tinymist preview websocket target unavailable.')
  });
}

function sendUpgradeErrorResponse(socket: net.Socket, statusCode: number, message: string): void {
  if (socket.destroyed) return

  const reason = statusCode === 404
    ? 'Not Found'
    : statusCode === 502
      ? 'Bad Gateway'
      : statusCode === 503
        ? 'Service Unavailable'
        : 'Error'
  const body = JSON.stringify({ error: message })
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    '\r\n' +
    body,
  )
  socket.end()
}

function forwardHeaders(req: Request): Headers {
  const headers = new Headers()
  for (const [key, val] of Object.entries(req.headers)) {
    if (val && ['accept', 'cache-control', 'range', 'content-type'].includes(key.toLowerCase())) {
        if (Array.isArray(val)) val.forEach(v => headers.append(key, v))
        else headers.set(key, val)
    }
  }
  return headers
}

function cleanupExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, s] of sessions) {
    if (s.lastTouchedAt < cutoff) {
      s.process?.kill('SIGTERM')
      rmSync(s.workspaceDir, { recursive: true, force: true })
      sessions.delete(id)
    }
  }
}

function allocatePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => res(p))
    }).on('error', rej)
  })
}

async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(port)) return true
    await new Promise(r => setTimeout(r, 50))
  }
  return false
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(res => {
    const s = net.createConnection({ host: '127.0.0.1', port }).on('connect', () => { s.destroy(); res(true) }).on('error', () => { s.destroy(); res(false) })
  })
}

function getWorkspaceHash(workspace: ProjectWorkspace): string {
  const hash = createHash('sha256')
  hash.update(workspace.entryPath)
  workspace.files.sort((a,b)=>a.path.localeCompare(b.path)).forEach(f => {
    hash.update(f.path + f.mimeType + f.content)
  })
  return hash.digest('hex')
}
