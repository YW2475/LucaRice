/** The General section: one column rendering feature-owned item contributions. */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DataStorageSection } from './DataStorageSection.tsx'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> & PropsLocale<'settings'> & {
    api: IApiClient
    local: boolean
  }

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ api, local, renderSlot, t }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      {local ? <DataStorageSection api={api} t={t} /> : null}
      {renderSlot('settings.general.item', {})}
    </div>
  )
}
