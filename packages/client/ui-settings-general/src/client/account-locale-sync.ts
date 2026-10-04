/** Keep LucaRice's account-owned reply language aligned with the browser selector. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'

const endpoint = '/_lucarice/auth/locale'

function isLocale(value: string | null): value is LocaleId {
  return value === 'zh' || value === 'en' || value === 'fr'
}

/** Bind the language selector to the signed-in account's saved preference. */
export function syncAccountLocale(ctx: ClientContext): void {
  if (typeof window === 'undefined') return
  ctx.effect(() => {
    let userId: string | undefined
    let disposed = false
    const save = (preference: LocaleId): void => {
      if (userId === undefined) return
      window.localStorage.setItem(`lucarice.locale.${userId}`, preference)
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preference }),
      })
    }
    const off = ctx.on('locale/change', snapshot => { save(snapshot.active) })
    void fetch(endpoint).then(async response => {
      if (!response.ok || disposed) return
      const result = await response.json() as { userId: string; preference: LocaleId | null }
      if (disposed) return
      userId = result.userId
      const stored = window.localStorage.getItem(`lucarice.locale.${userId}`)
      const selected = result.preference ?? (isLocale(stored) ? stored : 'zh')
      if (ctx.locale.getLocale().active === selected) {
        if (result.preference === null) save(selected)
      } else {
        ctx.locale.setLocale(selected)
      }
    })
    return () => { disposed = true; off() }
  }, 'lucarice: account locale sync')
}
