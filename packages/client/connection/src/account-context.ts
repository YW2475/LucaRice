/** Server-side account identity shared by the Web transport and API gateway. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage } from 'node:http'

export type AccountUser = { id: string; username: string; role: 'admin' | 'user' }

export interface AccountService {
  userForRequest(request: IncomingMessage): AccountUser | undefined
  ownsSession(userId: string, sessionId: string): boolean
  claimSession(userId: string, sessionId: string): void
  ownerForSession(sessionId: string): string | undefined
  localeForSession(sessionId: string): 'zh' | 'en' | 'fr'
  archivedSessionIds(userId: string): string[]
  archiveSession(userId: string, sessionId: string): string[]
  userDataDir(userId: string, area: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    accounts: AccountService
  }
}

const key = Symbol.for('lucarice.request-account')
const root = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<AccountUser> }
const activeAccount = root[key] ??= new AsyncLocalStorage<AccountUser>()

export function runAsAccount<T>(user: AccountUser, work: () => T): T {
  return activeAccount.run(user, work)
}

export function currentAccount(): AccountUser | undefined {
  return activeAccount.getStore()
}
