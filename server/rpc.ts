import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { BACKGROUND_CONTEXT, withCancel } from '@earendil-works/chord/context'
import type { ConversationId } from '@earendil-works/pi-durable'
import type { Host } from './host.ts'
import type { WorkspaceManager } from './workspaces.ts'

const json = (response: ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}
const error = (response: ServerResponse, status: number, message: string): void => {
  if (response.headersSent) { response.end(); return }
  json(response, status, { error: { message } })
}

export interface RpcServer {
  token: string
  url: string
  close(): Promise<void>
}

export async function startRpcServer(host: Host | WorkspaceManager, port = 4174): Promise<RpcServer> {
  const workspaces = 'host' in host ? host : undefined
  const activeHost = (): Host => workspaces?.host ?? (host as Host)
  const token = process.env.DURABLE_AUTH_TOKEN ?? randomBytes(24).toString('base64url')
  const session = randomBytes(24).toString('base64url')
  const origin = `http://127.0.0.1:${port}`
  const authenticated = (request: IncomingMessage): boolean => {
    const cookies = request.headers.cookie?.split(';').map(part => part.trim().split('=')) ?? []
    return cookies.some(([key, value]) => key === 'dw_session' && value === session)
  }
  const allowedOrigin = (request: IncomingMessage): boolean => {
    const value = request.headers.origin
    return value === undefined || value === origin || value === `http://localhost:${port}`
      || value === 'http://127.0.0.1:5173' || value === 'http://localhost:5173'
  }
  const sockets = new WebSocketServer({ noServer: true })
  const server = createServer(async (request, response) => {
    try {
      if (!allowedOrigin(request)) return error(response, 403, 'Origin is not allowed')
      const url = new URL(request.url ?? '/', origin)
      if (request.method === 'POST' && url.pathname === '/api/auth') {
        if (request.headers['x-workbench-token'] !== token) return error(response, 401, 'Invalid access token')
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': `dw_session=${session}; HttpOnly; SameSite=Strict; Path=/` })
        return response.end('{"ok":true}')
      }
      if (url.pathname === '/api/health') return json(response, 200, { ok: true })
      const publicAsset = request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/assets/'))
      if (!authenticated(request) && !publicAsset) return error(response, 401, 'Authentication required')
      if (request.method === 'GET' && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/assets/'))) {
        const assetPath = url.pathname.replace(/^\/api\/assets/, '/assets')
        const file = resolve('dist', `.${assetPath}`)
        if (!file.startsWith(`${resolve('dist')}${sep}`)) return error(response, 403, 'Asset path is not allowed')
        try {
          const info = await stat(file)
          if (!info.isFile()) throw new Error('not file')
          const content = await readFile(file)
          response.writeHead(200, { 'content-type': contentType(extname(file)) })
          return response.end(content)
        } catch { return error(response, 404, 'Asset not found') }
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        try {
          const content = await readFile(resolve('dist/index.html'), 'utf8')
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(content) })
          return response.end(content)
        } catch { return error(response, 404, 'Run the Vite development server first') }
      }
      if (workspaces && url.pathname === '/api/workspaces') {
        if (request.method === 'GET') return json(response, 200, workspaces.state)
        if (request.method === 'POST') {
          const payload = JSON.parse(await readBody(request)) as { path?: unknown }
          if (typeof payload.path !== 'string') return error(response, 400, 'Workspace path is required')
          const state = await workspaces.select(payload.path)
          for (const client of sockets.clients) client.close()
          return json(response, 200, state)
        }
        if (request.method === 'DELETE') {
          const payload = JSON.parse(await readBody(request)) as { path?: unknown }
          if (typeof payload.path !== 'string') return error(response, 400, 'Workspace path is required')
          const state = await workspaces.remove(payload.path)
          for (const client of sockets.clients) client.close()
          return json(response, 200, state)
        }
      }
      if (workspaces && url.pathname === '/api/plugins') {
        if (request.method === 'GET') return json(response, 200, { items: workspaces.host.plugins.items })
        if (request.method === 'POST') {
          const payload = JSON.parse(await readBody(request)) as { id?: unknown; enabled?: unknown }
          if (typeof payload.id !== 'string') return error(response, 400, 'Plugin id is required')
          if (typeof payload.enabled !== 'boolean') return error(response, 400, 'Plugin enabled state must be boolean')
          const previousHost = workspaces.host
          const previous = previousHost.plugins.items.find(item => item.id === payload.id)
          if (!previous) return error(response, 400, `Unknown plugin: ${payload.id}`)
          await previousHost.plugins.setEnabled(payload.id, payload.enabled)
          try {
            await workspaces.restart()
          } catch (cause) {
            try {
              await previousHost.plugins.setEnabled(payload.id as string, previous.enabled)
              await workspaces.restart()
            } catch (rollbackCause) {
              throw new Error(`Plugin reload and recovery failed: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`)
            } finally {
              for (const client of sockets.clients) client.close()
            }
            throw cause
          }
          for (const client of sockets.clients) client.close()
          return json(response, 200, { items: workspaces.host.plugins.items })
        }
      }
      if (workspaces && url.pathname === '/api/runtime') {
        if (request.method === 'GET') return json(response, 200, workspaces.host.runtime.state)
        if (request.method === 'POST') {
          const payload = JSON.parse(await readBody(request)) as { compactModel?: { provider: string; modelId: string } }
          const previousHost = workspaces.host
          if (payload.compactModel && !previousHost.context.models.getModel(payload.compactModel.provider, payload.compactModel.modelId)) return error(response, 400, 'Compact 模型不可用，请检查 Provider 配置')
          const previous = previousHost.runtime.state
          await previousHost.runtime.save(payload)
          try {
            await workspaces.restart()
          } catch (cause) {
            try {
              await previousHost.runtime.save(previous)
              await workspaces.restart()
            } catch (rollbackCause) {
              throw new Error(`运行策略重载及恢复失败：${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`)
            } finally {
              for (const client of sockets.clients) client.close()
            }
            throw cause
          }
          for (const client of sockets.clients) client.close()
          return json(response, 200, workspaces.host.runtime.state)
        }
      }
      if (request.method !== 'POST' || url.pathname !== '/api/command') return error(response, 404, 'Not found')
      const body = await readBody(request)
      const payload = JSON.parse(body) as { name?: string; args?: unknown }
      const command = typeof payload.name === 'string' ? activeHost().context.commands.get(payload.name) : undefined
      if (!command) return error(response, 404, 'Unknown command')
      const args = command.schema.parse(payload.args ?? {})
      const result = await command.handler(args, BACKGROUND_CONTEXT)
      return json(response, 200, { result })
    } catch (cause) {
      console.error('RPC request failed', cause instanceof Error ? cause.name : 'Error')
      const message = cause instanceof Error ? cause.message : 'Command failed'
      return error(response, 400, message)
    }
  })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', origin)
    if (url.pathname !== '/ws' || !allowedOrigin(request) || !authenticated(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request))
  })
  sockets.on('connection', (client: WebSocket) => {
    const subscriptions = new Map<string, () => void>()
    let queue = Promise.resolve()
    client.on('message', (data: WebSocket.RawData) => {
      queue = queue.then(async () => {
        try {
          const message = JSON.parse(data.toString()) as { type?: string; id?: string; channel?: string; conversationId?: number; document?: string }
          if (message.type === 'unsubscribe' && message.id) {
            subscriptions.get(message.id)?.()
            subscriptions.delete(message.id)
            return
          }
          if (message.type !== 'subscribe' || !message.id || !message.channel || !message.conversationId) return
          subscriptions.get(message.id)?.()
          const cleanup = await subscribe(client, message.id, message.channel, message.conversationId, message.document, activeHost())
          subscriptions.set(message.id, cleanup)
        } catch (cause) {
          send(client, { type: 'error', message: cause instanceof Error ? cause.message : 'Subscription failed' })
        }
      }).catch(() => {})
    })
    client.on('close', () => { for (const cleanup of subscriptions.values()) cleanup() })
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolveListen())
  })
  return {
    token,
    url: origin,
    close: async () => {
      for (const client of sockets.clients) client.close()
      sockets.close()
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    },
  }
}

async function subscribe(client: WebSocket, id: string, channel: string, conversationId: number, document: string | undefined, host: Host): Promise<() => void> {
  if (client.bufferedAmount > 1_000_000) { client.close(); return () => {} }
  const { context, cancel } = withCancel(BACKGROUND_CONTEXT)
  let stop = async (): Promise<void> => {}
  if (channel === 'conversation') {
    const conversation = await host.context.conversation(conversationId, context)
    if (!conversation) throw new Error('Conversation not found')
    const watch = await conversation.watch(context)
    send(client, { type: 'snapshot', id, value: watch.value })
    watch.start(async (_value, ops) => { send(client, { type: 'delta', id, ops }) })
    stop = async () => { await watch.stop() }
  } else if (channel === 'tasks') {
    const watch = await host.harness.watchTaskGraph(context)
    send(client, { type: 'snapshot', id, value: watch.value })
    watch.start(async value => { send(client, { type: 'snapshot', id, value }) })
    stop = async () => { await watch.stop() }
  } else if (channel === 'document' && document) {
    const registration = host.context.documents.get(document)
    if (!registration) throw new Error('Document is not public')
    const watch = await host.harness.watchDoc(registration.token, conversationId as ConversationId, context)
    if (!watch) throw new Error('Document not found')
    send(client, { type: 'snapshot', id, value: watch.value })
    watch.start(async value => { send(client, { type: 'snapshot', id, value }) })
    stop = async () => { await watch.stop() }
  } else {
    cancel()
    throw new Error('Unknown channel')
  }
  return () => { cancel(); void stop() }
}

function send(client: WebSocket, value: unknown): void {
  if (client.readyState !== WebSocket.OPEN) return
  if (client.bufferedAmount >= 1_000_000) { client.close(); return }
  client.send(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('Request body is too large')
  }
  return body
}

function contentType(extension: string): string {
  return ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' } as Record<string, string>)[extension] ?? 'application/octet-stream'
}
