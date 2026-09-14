/**
 * @deepseek-ai/dsh-host-apiproxy — the API gateway every client shape shares:
 * the ApiProxy contract (api/: types + zod schemas, browser-safe), the fetch
 * carrier pair (fetch/: toFetchHandler on the host side, AbstractApiClient +
 * platform subclasses on the client side), and the host-side implementation
 * (api-proxy.ts: createApiProxy + the ApiProxyService gateway plugin providing
 * `ctx.apiProxy`). Transport-agnostic by design: this package registers no
 * routes — physical carriers wrap `ctx.apiProxy` themselves.
 *
 * The gateway consumes `ctx.agentDefaultModel`, the transport-independent default
 * shared with direct entry points. Switching models persists through that
 * service; sessions that have already logged a selection remain unchanged.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { ApiProxy } from './api/index.ts'
import type { WorkspaceId } from './api/workspace.ts'
import { createApiProxy, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from './api-proxy.ts'
import { currentAccount } from './account-context.ts'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  type SessionLogCompressionLevel,
} from './session-export.ts'

const DEFAULT_ROOT_WORKSPACE_ID = 'lucarice-root' as WorkspaceId

export type * from './api/index.ts'
export { RpcId } from './api/rpc.ts'
export { toFetchHandler } from './fetch/handler.ts'
export { AbstractApiClient, InProcessApiClient } from './fetch/client.ts'
export type { IApiClient } from './fetch/client.ts'
export { createApiProxy } from './api-proxy.ts'
export type { ApiProxyDefaults } from './api-proxy.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host-side ApiProxy implementation (the transport-agnostic gateway face). */
    apiProxy: ApiProxy
  }
}

/** Gateway plugin configuration. */
export interface Config {
  /**
   * Whether this deployment can hand paths to a native desktop opener —
   * the `hasDocument` capability the agent-preset roster reports. Absent,
   * the platform is asked (macOS/Windows/WSL yes; Linux only with a display
   * server); set it explicitly where detection misleads, e.g. `false` in a
   * container whose DISPLAY points nowhere a user can see.
   */
  nativeOpen?: boolean
  /**
   * DEFLATE level for every session-log ZIP entry: `0` stores without
   * compression, `1` favors CPU/latency, and `9` favors archive size.
   * @default 6
   */
  sessionExportCompressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Maximum physical size of a cold Session artifact eligible for blankness
   * verification. Zero disables probes.
   * @default 1024
   */
  coldBlankProbeMaxBytes?: number
}

/**
 * The API gateway service: implements the ApiProxy contract over the composed
 * host context and provides it as `ctx.apiProxy`. The Host cwd is the default
 * project directory.
 */
export class ApiProxyService extends Service implements ApiProxy {
  static inject = [
    'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
    'tools', 'userQuestions', 'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
    sessionExportCompressionLevel: z.number().step(1).min(0).max(9)
      .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as z<SessionLogCompressionLevel>,
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
  })

  readonly sessions: ApiProxy['sessions']
  readonly subagents: ApiProxy['subagents']
  readonly workspace: ApiProxy['workspace']
  readonly host: ApiProxy['host']
  readonly goals: ApiProxy['goals']
  readonly skills: ApiProxy['skills']
  readonly agentPresets: ApiProxy['agentPresets']
  readonly settings: ApiProxy['settings']
  readonly credentials: ApiProxy['credentials']
  readonly llm: ApiProxy['llm']
  readonly events: ApiProxy['events']
  readonly downloads: ApiProxy['downloads']
  readonly respond: ApiProxy['respond']

  constructor(ctx: Context, config: Config) {
    super(ctx, 'apiProxy')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      saveDefaultModelSelection: selection => ctx.agentDefaultModel.saveSelection(selection),
      cwd: process.cwd(),
      ...config.nativeOpen === undefined ? {} : { canOpenPath: () => config.nativeOpen as boolean },
      ...(config.sessionExportCompressionLevel === undefined
        ? {}
        : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
      ...(config.coldBlankProbeMaxBytes === undefined
        ? {}
        : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
    })
    const blocked = <Id>(request: { rpcId: Id }) => ({
      rpcId: request.rpcId,
      result: { ok: false as const, error: { code: 'internal' as const, message: '此操作不可用', details: {} } },
    })
    const adminOnly = <Id>(request: { rpcId: Id }) => ({
      rpcId: request.rpcId,
      result: { ok: false as const, error: { code: 'internal' as const, message: '只有管理员可以修改全局设置', details: {} } },
    })
    const sessions = api.sessions
    const allowed = (sessionId: string): boolean => {
      const user = currentAccount()
      return user !== undefined && ctx.get('accounts')?.ownsSession(user.id, sessionId) === true
    }
    const sessionRequest = (method: keyof typeof sessions) => async (request: any, ...rest: any[]) => {
      if (!allowed(String(request.payload.sessionId))) return blocked(request)
      return (sessions[method] as any)(request, ...rest)
    }
    this.sessions = {
      ...sessions,
      async list(request) {
        const user = currentAccount()
        if (user === undefined) return blocked(request)
        const result = await sessions.list(request)
        if (result.result.ok) result.result.value.items = result.result.value.items.filter(item => ctx.get('accounts')?.ownsSession(user.id, String(item.sessionId)) === true)
        return result
      },
      async search(request, signal) {
        const user = currentAccount()
        if (user === undefined) return blocked(request)
        const result = await sessions.search(request, signal)
        if (result.result.ok) result.result.value.items = result.result.value.items.filter(item => ctx.get('accounts')?.ownsSession(user.id, String(item.sessionId)) === true)
        return result
      },
      async create(request) {
        const user = currentAccount()
        if (user === undefined) return blocked(request)
        if (request.payload.sessionId !== undefined && !ctx.get('accounts')?.ownsSession(user.id, String(request.payload.sessionId))) {
          const known = await sessions.list({ ...request, payload: {} })
          if (known.result.ok && known.result.value.items.some(item => item.sessionId === request.payload.sessionId)) return blocked(request)
        }
        const { workspaceId, ...payload } = request.payload
        const result = await sessions.create({
          ...request,
          payload: {
            agentPreset: 'rice-chat',
            ...payload,
            ...(workspaceId === undefined || workspaceId === DEFAULT_ROOT_WORKSPACE_ID ? {} : { workspaceId }),
          },
        })
        if (result.result.ok) ctx.get('accounts')?.claimSession(user.id, String(result.result.value.sessionId))
        return result
      },
      history: sessionRequest('history'),
      models: sessionRequest('models'),
      selectModel: sessionRequest('selectModel'),
      rename: sessionRequest('rename'),
      prompt: sessionRequest('prompt'),
      attachment: sessionRequest('attachment'),
      updateQueue: sessionRequest('updateQueue'),
      cancel: sessionRequest('cancel'),
      async fork(request) {
        const user = currentAccount()
        if (user === undefined || !allowed(String(request.payload.sessionId))) return blocked(request)
        const result = await sessions.fork(request)
        if (result.result.ok) ctx.get('accounts')?.claimSession(user.id, String(result.result.value.sessionId))
        return result
      },
    } as ApiProxy['sessions']
    const subagents: ApiProxy['subagents'] = {
      list: request => Promise.resolve(blocked(request)),
      history: request => Promise.resolve(blocked(request)),
      prompt: request => Promise.resolve(blocked(request)),
      interrupt: request => Promise.resolve(blocked(request)),
    }
    this.subagents = subagents
    const workspace: ApiProxy['workspace'] = {
      list: request => {
        const user = currentAccount()
        if (user === undefined) return Promise.resolve(blocked(request))
        return sessions.list({ ...request, payload: {} }).then(result => {
          const sessionIds = result.result.ok
            ? result.result.value.items
              .filter(item => ctx.get('accounts')?.ownsSession(user.id, String(item.sessionId)) === true)
              .map(item => item.sessionId)
            : []
          const archivedSessionIds = ctx.get('accounts')?.archivedSessionIds(user.id) ?? []
          return {
            rpcId: request.rpcId,
            result: {
              ok: true as const,
              value: {
                items: [{
                  workspaceId: DEFAULT_ROOT_WORKSPACE_ID,
                  path: process.cwd(),
                  title: 'LucaRice',
                  sessionIds,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                }],
                archivedSessionIds,
              },
            },
          }
        })
      },
      create: request => Promise.resolve(blocked(request)),
      rename: request => Promise.resolve(blocked(request)),
      delete: request => Promise.resolve(blocked(request)),
      insertBefore: request => Promise.resolve(blocked(request)),
      insertSessionBefore: request => Promise.resolve(blocked(request)),
      archiveSession: request => {
        const user = currentAccount()
        if (user === undefined || !allowed(String(request.payload.sessionId))) return Promise.resolve(blocked(request))
        const archivedSessionIds = ctx.get('accounts')?.archiveSession(user.id, String(request.payload.sessionId)) ?? []
        return Promise.resolve({ rpcId: request.rpcId, result: { ok: true as const, value: { archivedSessionIds } } })
      },
    }
    this.workspace = workspace
    const host: ApiProxy['host'] = {
      ...api.host,
      setDataRoot: request => currentAccount()?.role === 'admin' ? api.host.setDataRoot(request) : Promise.resolve(adminOnly(request)),
      pickDirectory: (request, signal) => currentAccount()?.role === 'admin' ? api.host.pickDirectory(request, signal) : Promise.resolve(adminOnly(request)),
      listDirectory: (request, signal) => currentAccount()?.role === 'admin' ? api.host.listDirectory(request, signal) : Promise.resolve(adminOnly(request)),
      createDirectory: request => currentAccount()?.role === 'admin' ? api.host.createDirectory(request) : Promise.resolve(adminOnly(request)),
      openPath: (request, signal) => currentAccount()?.role === 'admin' ? api.host.openPath(request, signal) : Promise.resolve(adminOnly(request)),
    }
    this.host = host
    const goals: ApiProxy['goals'] = {
      create: request => Promise.resolve(blocked(request)),
      edit: request => Promise.resolve(blocked(request)),
      pause: request => Promise.resolve(blocked(request)),
      resume: request => Promise.resolve(blocked(request)),
      complete: request => Promise.resolve(blocked(request)),
      clear: request => Promise.resolve(blocked(request)),
    }
    this.goals = goals
    const skills: ApiProxy['skills'] = {
      list: request => allowed(String(request.payload.sessionId)) ? api.skills.list(request) : Promise.resolve(blocked(request)),
    }
    this.skills = skills
    const agentPresets: ApiProxy['agentPresets'] = {
      ...api.agentPresets,
      async list(request) {
        const result = await api.agentPresets.list(request)
        if (!result.result.ok) return result
        result.result.value.presets = result.result.value.presets.filter(item => item.id === 'rice-chat')
        result.result.value.authorable = false
        result.result.value.hasDocument = false
        return result
      },
      select: request => allowed(String(request.payload.sessionId))
        ? api.agentPresets.select({ ...request, payload: { ...request.payload, agentPreset: 'rice-chat' } })
        : Promise.resolve(blocked(request)),
      read: request => Promise.resolve(adminOnly(request)),
      copy: request => Promise.resolve(adminOnly(request)),
      openDocument: request => Promise.resolve(adminOnly(request)),
      remove: request => Promise.resolve(adminOnly(request)),
    }
    this.agentPresets = agentPresets
    this.settings = {
      ...api.settings,
      openDocument: async (request, signal) => currentAccount()?.role === 'admin'
        ? api.settings.openDocument(request, signal)
        : adminOnly(request),
      update: async request => currentAccount()?.role === 'admin'
        ? api.settings.update(request)
        : adminOnly(request),
      replace: async request => currentAccount()?.role === 'admin'
        ? api.settings.replace(request)
        : adminOnly(request),
      mutate: async request => currentAccount()?.role === 'admin'
        ? api.settings.mutate(request)
        : adminOnly(request),
    } as ApiProxy['settings']
    this.credentials = api.credentials
    this.llm = api.llm
    const visibleEvents = async function* (frames: AsyncIterable<any>): AsyncIterable<any> {
      const user = currentAccount()
      if (user === undefined) {
        yield* frames
        return
      }
      for await (const frame of frames) {
        const sessionId = frame.payload.sessionId
        if (typeof sessionId === 'string' && ctx.get('accounts')?.ownsSession(user.id, sessionId)) yield frame
      }
    }
    this.events = {
      mux: (request, signal) => visibleEvents(api.events.mux(request, signal)),
      host: (request, signal) => visibleEvents(api.events.host(request, signal)),
    } as ApiProxy['events']
    this.downloads = {
      sessionLog: (request, signal) => allowed(String(request.sessionId))
        ? api.downloads.sessionLog(request, signal)
        : Promise.resolve(new Response('session not found', { status: 404 })),
    }
    // createApiProxy returns closures (no `this` capture), so the bind is
    // behavior-neutral.
    this.respond = message => {
      const sessionId = message.result.ok ? (message.result.value as { sessionId?: string }).sessionId : undefined
      if (sessionId === undefined || !allowed(sessionId)) return Promise.resolve({ accepted: false, reason: 'not-pending' })
      return api.respond(message)
    }
  }
}

export default ApiProxyService
