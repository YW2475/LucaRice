/** Local account service backed by LucaRice's independent business database. */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AccountService, AccountUser } from '@deepseek-ai/dsh-client-connection/src/account-context.ts'

export const name = 'lucarice-accounts'
export const inject = ['webServer']

type StoredUser = AccountUser & { salt: string; password: string; enabled?: boolean }
type StoredAccounts = {
  users: StoredUser[]
  sessions: Record<string, string>
  sessionOwners: Record<string, string>
  archivedSessions: Record<string, string[]>
}

type StoredAccount = Omit<StoredUser, 'enabled'> & { enabled: number }

export interface Config {
  dataRoot: string
  legacyFields: string
  services?: Record<string, string>
}

function password(value: string, salt: string): string {
  return scryptSync(value, salt, 32).toString('hex')
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1)
}

function reply(response: import('node:http').ServerResponse, status: number, body: object, cookie?: string): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...(cookie === undefined ? {} : { 'set-cookie': cookie }) })
  response.end(text)
}

/** Owns LucaRice account, browser-session, and chat-ownership records. */
export class LucaRiceAccounts extends Service implements AccountService {
  private readonly db: DatabaseSync

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'accounts')
    mkdirSync(config.dataRoot, { recursive: true })
    this.db = new DatabaseSync(join(config.dataRoot, 'lucarice.sqlite3'))
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        salt TEXT NOT NULL,
        password TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS login_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chat_session_owners (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS archived_chat_sessions (
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        PRIMARY KEY (user_id, session_id)
      ) STRICT;
    `)
    this.importLegacyAccounts(join(config.dataRoot, 'accounts.json'))
  }

  private importLegacyAccounts(file: string): void {
    if (!existsSync(file) || this.accountCount() > 0) return
    const legacy = JSON.parse(readFileSync(file, 'utf8')) as StoredAccounts
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const insertAccount = this.db.prepare('INSERT INTO accounts (id, username, role, salt, password, enabled) VALUES (?, ?, ?, ?, ?, ?)')
      for (const user of legacy.users) insertAccount.run(user.id, user.username, user.role, user.salt, user.password, user.enabled === false ? 0 : 1)
      const insertLogin = this.db.prepare('INSERT OR IGNORE INTO login_sessions (token, user_id) VALUES (?, ?)')
      for (const [token, userId] of Object.entries(legacy.sessions)) insertLogin.run(token, userId)
      const insertOwner = this.db.prepare('INSERT OR IGNORE INTO chat_session_owners (session_id, user_id) VALUES (?, ?)')
      for (const [sessionId, userId] of Object.entries(legacy.sessionOwners)) insertOwner.run(sessionId, userId)
      const insertArchived = this.db.prepare('INSERT OR IGNORE INTO archived_chat_sessions (user_id, session_id) VALUES (?, ?)')
      for (const [userId, sessionIds] of Object.entries(legacy.archivedSessions ?? {})) {
        for (const sessionId of sessionIds) insertArchived.run(userId, sessionId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private accountCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number }).count
  }

  private firstUserId(): string | undefined {
    return (this.db.prepare('SELECT id FROM accounts ORDER BY rowid LIMIT 1').get() as { id: string } | undefined)?.id
  }

  private accountForUsername(username: string): StoredAccount | undefined {
    return this.db.prepare('SELECT id, username, role, salt, password, enabled FROM accounts WHERE username = ?').get(username) as StoredAccount | undefined
  }

  userForRequest(request: import('node:http').IncomingMessage): AccountUser | undefined {
    const token = cookieValue(request.headers.cookie, 'lucarice_session')
    if (token === undefined) return undefined
    return this.db.prepare(`
      SELECT accounts.id, accounts.username, accounts.role
      FROM login_sessions JOIN accounts ON accounts.id = login_sessions.user_id
      WHERE login_sessions.token = ? AND accounts.enabled = 1
    `).get(token) as AccountUser | undefined
  }

  ownsSession(userId: string, sessionId: string): boolean {
    return this.ownerForSession(sessionId) === userId
  }

  ownerForSession(sessionId: string): string | undefined {
    return (this.db.prepare('SELECT user_id FROM chat_session_owners WHERE session_id = ?').get(sessionId) as { user_id: string } | undefined)?.user_id ?? this.firstUserId()
  }

  archivedSessionIds(userId: string): string[] {
    return (this.db.prepare('SELECT session_id FROM archived_chat_sessions WHERE user_id = ? ORDER BY rowid').all(userId) as { session_id: string }[]).map(row => row.session_id)
  }

  archiveSession(userId: string, sessionId: string): string[] {
    this.db.prepare('INSERT OR IGNORE INTO archived_chat_sessions (user_id, session_id) VALUES (?, ?)').run(userId, sessionId)
    return this.archivedSessionIds(userId)
  }

  userDataDir(userId: string, area: string): string {
    const directory = join(this.config.dataRoot, 'users', userId, area)
    mkdirSync(directory, { recursive: true })
    return directory
  }

  claimSession(userId: string, sessionId: string): void {
    this.db.prepare('INSERT INTO chat_session_owners (session_id, user_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id').run(sessionId, userId)
  }

  private create(username: string, plainPassword: string, role: 'admin' | 'user'): AccountUser {
    if (username.length === 0 || plainPassword.length === 0) throw new Error('用户名和密码不能为空')
    if (this.accountForUsername(username) !== undefined) throw new Error('用户名已存在')
    const salt = randomBytes(16).toString('hex')
    const user = { id: randomUUID(), username, role, salt, password: password(plainPassword, salt) }
    this.db.prepare('INSERT INTO accounts (id, username, role, salt, password) VALUES (?, ?, ?, ?, ?)').run(user.id, user.username, user.role, user.salt, user.password)
    mkdirSync(join(this.config.dataRoot, 'users', user.id), { recursive: true })
    return { id: user.id, username: user.username, role: user.role }
  }

  private changePassword(user: StoredAccount, plainPassword: string): void {
    if (plainPassword.length === 0) throw new Error('密码不能为空')
    const salt = randomBytes(16).toString('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE accounts SET salt = ?, password = ? WHERE id = ?').run(salt, password(plainPassword, salt), user.id)
      this.db.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(user.id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private start(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, user: AccountUser): void {
    const token = randomUUID()
    this.db.prepare('INSERT INTO login_sessions (token, user_id) VALUES (?, ?)').run(token, user.id)
    const forwarded = request.headers['x-forwarded-proto']
    const secure = (request.socket as { encrypted?: boolean }).encrypted === true || forwarded === 'https'
    reply(response, 200, { user }, `lucarice_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
  }

  handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void {
    const path = request.url?.split('?')[0]
    if (request.method === 'GET' && path === '/_lucarice/auth/me') {
      const user = this.userForRequest(request)
      reply(response, user === undefined ? 401 : 200, user === undefined ? { error: '未登录', initialized: this.accountCount() > 0 } : { user, initialized: true })
      return
    }
    if (request.method === 'GET' && path === '/_lucarice/auth/services') {
      const user = this.userForRequest(request)
      if (user?.role !== 'admin') { reply(response, 403, { error: '仅管理员可查看服务状态' }); return }
      void Promise.all(Object.entries(this.config.services ?? {}).map(async ([id, url]) => {
        try {
          const result = await fetch(url)
          return { id, online: result.ok }
        } catch (error) {
          return { id, online: false, error: error instanceof Error ? error.message : String(error) }
        }
      })).then(services => { reply(response, 200, { services }) })
      return
    }
    const chunks: Buffer[] = []
    request.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
    request.on('end', () => {
      try {
        const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as { username?: string; password?: string }
        if (request.method === 'POST' && path === '/_lucarice/auth/bootstrap') {
          if (this.accountCount() > 0) throw new Error('账户已初始化')
          const user = this.create(body.username ?? '', body.password ?? '', 'admin')
          if (existsSync(this.config.legacyFields)) cpSync(this.config.legacyFields, join(this.config.dataRoot, 'users', user.id, 'fields'), { recursive: true })
          const legacyCredentials = join(this.config.dataRoot, '.credentials.yaml')
          if (existsSync(legacyCredentials)) copyFileSync(legacyCredentials, join(this.config.dataRoot, 'users', user.id, 'credentials.yaml'))
          this.start(request, response, user)
          return
        }
        if (request.method === 'POST' && path === '/_lucarice/auth/login') {
          const stored = this.accountForUsername(body.username ?? '')
          if (stored === undefined || stored.enabled === 0 || !body.password || !timingSafeEqual(Buffer.from(stored.password, 'hex'), Buffer.from(password(body.password, stored.salt), 'hex'))) throw new Error('用户名或密码错误')
          this.start(request, response, stored)
          return
        }
        if (request.method === 'POST' && path === '/_lucarice/auth/logout') {
          const token = cookieValue(request.headers.cookie, 'lucarice_session')
          if (token !== undefined) this.db.prepare('DELETE FROM login_sessions WHERE token = ?').run(token)
          reply(response, 200, { ok: true }, 'lucarice_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
          return
        }
        if (request.method === 'POST' && path === '/_lucarice/auth/users') {
          const requester = this.userForRequest(request)
          if (requester?.role !== 'admin') { reply(response, 403, { error: '仅管理员可创建账户' }); return }
          reply(response, 200, { user: this.create(body.username ?? '', body.password ?? '', 'user') })
          return
        }
        if (request.method === 'GET' && path === '/_lucarice/auth/users') {
          const requester = this.userForRequest(request)
          if (requester?.role !== 'admin') { reply(response, 403, { error: '仅管理员可查看账户' }); return }
          const users = this.db.prepare('SELECT username, role, enabled FROM accounts ORDER BY rowid').all() as { username: string; role: 'admin' | 'user'; enabled: number }[]
          reply(response, 200, { users: users.map(user => ({ ...user, enabled: user.enabled === 1 })) })
          return
        }
        if (request.method === 'POST' && path === '/_lucarice/auth/users/status') {
          const requester = this.userForRequest(request)
          if (requester?.role !== 'admin') { reply(response, 403, { error: '仅管理员可管理账户' }); return }
          const statusBody = body as typeof body & { enabled?: boolean }
          const target = this.accountForUsername(statusBody.username ?? '')
          if (target === undefined) throw new Error('账户不存在')
          if (target.role === 'admin') throw new Error('管理员账户不可停用')
          this.db.exec('BEGIN IMMEDIATE')
          try {
            this.db.prepare('UPDATE accounts SET enabled = ? WHERE id = ?').run(statusBody.enabled === true ? 1 : 0, target.id)
            if (statusBody.enabled !== true) this.db.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(target.id)
            this.db.exec('COMMIT')
          } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
          }
          reply(response, 200, { ok: true })
          return
        }
        if (request.method === 'POST' && path === '/_lucarice/auth/password') {
          const requester = this.userForRequest(request)
          if (requester === undefined) { reply(response, 401, { error: '未登录' }); return }
          const target = this.accountForUsername(requester.role === 'admin' && body.username ? body.username : requester.username)
          if (target === undefined) throw new Error('账户不存在')
          this.changePassword(target, body.password ?? '')
          reply(response, 200, { ok: true })
          return
        }
        reply(response, 404, { error: 'not found' })
      } catch (error) {
        reply(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  const accounts = new LucaRiceAccounts(ctx, config)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/_lucarice/auth', handler: (request, response) => accounts.handle(request, response) }), 'lucarice-accounts.route()')
}
