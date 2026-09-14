/** Per-account model credentials for the LucaRice web service. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CredentialProvider, type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { type Context } from '@deepseek-ai/cordis'

export const name = 'account-credentials'

export interface Config { dataRoot: string }

type Account = { id: string }
type AccountStore = { getStore(): Account | undefined }
const accountStoreKey = Symbol.for('lucarice.request-account')

function currentAccount(): Account | undefined {
  return (globalThis as { [accountStoreKey]?: AccountStore })[accountStoreKey]?.getStore()
}

/** Stores each signed-in user's model keys beside that user's field data. */
export class AccountCredentialProvider extends CredentialProvider {
  constructor(ctx: Context, private readonly config: Config) { super(ctx) }

  private file(): string {
    const account = currentAccount()
    if (account === undefined) throw new Error('当前请求没有登录账户')
    return join(this.config.dataRoot, 'users', account.id, 'credentials.yaml')
  }

  private read(): Record<string, string> {
    const file = this.file()
    if (!existsSync(file)) return {}
    return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
      const matched = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
      if (matched === null) return []
      const [, ref, raw = ''] = matched
      return [[ref, raw.startsWith('"') ? JSON.parse(raw) as string : raw]]
    }))
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const account = currentAccount()
    if (account === undefined) return undefined
    const value = this.read()[ref]
    return value === undefined ? undefined : { value, source: 'account' }
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = this.read()[ref]
    return { configured: value !== undefined, ...(value === undefined ? {} : { source: 'account' }), writable: true }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    const file = this.file()
    const values = this.read()
    values[ref] = value
    mkdirSync(join(this.config.dataRoot, 'users', currentAccount()!.id), { recursive: true })
    writeFileSync(file, Object.entries(values).map(([key, item]) => `${key}: ${JSON.stringify(item)}`).join('\n') + '\n', 'utf8')
    this.notifyUpdated(ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    const file = this.file()
    const values = this.read()
    delete values[ref]
    mkdirSync(join(this.config.dataRoot, 'users', currentAccount()!.id), { recursive: true })
    writeFileSync(file, Object.entries(values).map(([key, item]) => `${key}: ${JSON.stringify(item)}`).join('\n') + '\n', 'utf8')
    this.notifyUpdated(ref)
  }
}

export function apply(ctx: Context, config: Config): void {
  new AccountCredentialProvider(ctx, config)
}
