/** Request account context shared with the browser transport without a package cycle. */

import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestAccount = { id: string; username: string; role: 'admin' | 'user' }

const key = Symbol.for('lucarice.request-account')
const root = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<RequestAccount> }
const store = root[key] ??= new AsyncLocalStorage<RequestAccount>()

export function currentAccount(): RequestAccount | undefined { return store.getStore() }
