/** LucaRice conversation and attachment storage controls. */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DataStorageSection.module.css'

interface StoragePaths {
  dataRoot: string
  sessionsPath: string
  attachmentsPath: string
}

/** Data-storage row props. */
export type DataStorageSectionProps = PropsLocale<'settings'> & { api: IApiClient }

/** Render local conversation and attachment directory actions. */
export function DataStorageSection({ api, t }: DataStorageSectionProps) {
  const [paths, setPaths] = useState<StoragePaths | null>(null)
  const [nextRoot, setNextRoot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.host.describe({}).then(response => {
      if (!response.result.ok) {
        setError(response.result.error.message)
        return
      }
      setPaths(response.result.value)
    })
  }, [api])

  const open = async (path: string): Promise<void> => {
    setError(null)
    const response = await api.host.openPath({ path })
    if (!response.result.ok) setError(response.result.error.message)
  }

  const choose = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const selected = await api.host.pickDirectory({})
    if (!selected.result.ok) {
      setError(selected.result.error.message)
      setBusy(false)
      return
    }
    if (selected.result.value.path === null) {
      setBusy(false)
      return
    }
    const saved = await api.host.setDataRoot({ path: selected.result.value.path })
    if (saved.result.ok) setNextRoot(saved.result.value.path)
    else setError(saved.result.error.message)
    setBusy(false)
  }

  return (
    <section className={css.section}>
      <div>
        <h3 className={css.title}>{t('storage.title')}</h3>
        <p className={css.description}>{t('storage.description')}</p>
      </div>
      {paths === null ? null : (
        <>
          <div className={css.path} title={paths.dataRoot}>{paths.dataRoot}</div>
          <div className={css.actions}>
            <Button variant="outline" size="sm" onClick={() => { void open(paths.sessionsPath) }}>
              {t('storage.openSessions')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { void open(paths.attachmentsPath) }}>
              {t('storage.openAttachments')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { void open(paths.dataRoot) }}>
              {t('storage.openRoot')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { void choose() }}>
              {t('storage.changeRoot')}
            </Button>
          </div>
        </>
      )}
      {nextRoot === null ? null : (
        <p className={css.notice}>{t('storage.restartRequired')}<br />{nextRoot}</p>
      )}
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
