/** Read-only Host plugin inventory registered into Web Settings. */

import { createElement } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { FieldManagementSettings } from './FieldManagementSettings.tsx'
import { en, fr, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale']

/** Loader entries shown in this deployment's Settings. */
export interface Config {
  visibleEntryIds?: string[]
}

const DEFAULT_VISIBLE_ENTRY_IDS = [
  'rice-rag-host', 'deterministic-tools-host', 'field-management-host', 'field-weather-host', 'rice-time-context', 'llm-pi-ai',
  'validate_pesticide_safety', 'lookup_rice_variety', 'search_web',
  'compute', 'date_math', 'export_table', 'ask_user_question', 'document_read', 'get_field_management_data', 'get_field_weather',
  'search_rice_cultivation', 'search_rice_water_fertilizer', 'search_rice_pest_disease',
  'search_rice_abiotic_stress', 'search_rice_harvest_quality', 'search_rice_variety_seed',
]

const entries: PluginInventorySnapshot['entries'] = [
  { entryId: 'rice-rag-host' as never, moduleName: '本地 RAG 知识服务', enabled: true, fiberPhase: 'active' },
  { entryId: 'deterministic-tools-host' as never, moduleName: '通用确定性工具服务', enabled: true, fiberPhase: 'active' },
  { entryId: 'field-management-host' as never, moduleName: '田块管理服务', enabled: true, fiberPhase: 'active' },
  { entryId: 'field-weather-host' as never, moduleName: '田块天气服务', enabled: true, fiberPhase: 'active' },
  { entryId: 'rice-time-context' as never, moduleName: '当前时间上下文', enabled: true, fiberPhase: 'active' },
  { entryId: 'llm-pi-ai' as never, moduleName: 'SiliconFlow Qwen3.6-27B', enabled: true, fiberPhase: 'active' },
  { entryId: 'validate_pesticide_safety' as never, moduleName: '农药禁限用核验', enabled: true, fiberPhase: 'active' },
  { entryId: 'lookup_rice_variety' as never, moduleName: '水稻品种审定查询', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_web' as never, moduleName: '联网动态信息搜索', enabled: true, fiberPhase: 'active' },
  { entryId: 'compute' as never, moduleName: '计算与单位换算', enabled: true, fiberPhase: 'active' },
  { entryId: 'date_math' as never, moduleName: '日期与时间计算', enabled: true, fiberPhase: 'active' },
  { entryId: 'export_table' as never, moduleName: '通用 CSV 表格导出', enabled: true, fiberPhase: 'active' },
  { entryId: 'ask_user_question' as never, moduleName: '田间情况追问', enabled: true, fiberPhase: 'active' },
  { entryId: 'document_read' as never, moduleName: '对话附件文档读取', enabled: true, fiberPhase: 'active' },
  { entryId: 'get_field_management_data' as never, moduleName: '田块管理数据', enabled: true, fiberPhase: 'active' },
  { entryId: 'get_field_weather' as never, moduleName: '田块与地点天气预报', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_cultivation' as never, moduleName: '栽培与生育调控检索', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_water_fertilizer' as never, moduleName: '水肥与土壤管理检索', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_pest_disease' as never, moduleName: '病虫草害防控检索', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_abiotic_stress' as never, moduleName: '气象灾害与非生物逆境检索', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_harvest_quality' as never, moduleName: '成熟收获与品质检索', enabled: true, fiberPhase: 'active' },
  { entryId: 'search_rice_variety_seed' as never, moduleName: '品种与种子生产检索', enabled: true, fiberPhase: 'active' },
]

/** The Settings field editor, supplied unchanged to the new-session shortcut. */
type SettingsFieldTranslate = (PropsRuntime<'settings.section'> & PropsLocale<'settings.pluginInventory'>)['t']

function HeroFieldManagementEditor({ t }: PropsRuntime<'conversation.hero.field-management-editor'> & PropsLocale<'settings.pluginInventory'>) {
  return createElement(FieldManagementSettings, { t: t as SettingsFieldTranslate })
}

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext, config: Config = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, fr }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => ({
    entries: entries
      .filter(entry => (config.visibleEntryIds ?? DEFAULT_VISIBLE_ENTRY_IDS).includes(entry.entryId))
      .map(entry => ({ ...entry, moduleName: t(`plugin.${entry.entryId}` as PluginInventoryLocaleKey) })),
  })
  const injected = (): PluginInventorySettingsTabInjected => ({ list })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'field-management',
    order: 20,
    label: () => t('fieldManagement'),
    locale: NS,
  }, FieldManagementSettings))

  ctx.slots.inject('conversation.hero.field-management-editor', () => ctx.slots.register({
    name: 'conversation.hero.field-management-editor',
    locale: NS,
  }, HeroFieldManagementEditor))
}
