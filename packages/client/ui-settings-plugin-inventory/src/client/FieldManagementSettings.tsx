import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './FieldManagementSettings.module.css'

interface FieldConfig {
  storage_name?: string
  project_name: string
  field_name: string
  location: string
  latitude: string
  longitude: string
  planting_area: string
  planted_variety: string
  sowing_date: string
  transplant_date: string
  cultivation_method: string
  season_type: string
  target_yield: string
  soil_info: string
  irrigation_condition: string
  sensor_provider: string
  platform_name: string
  api_base_url: string
  device_addr: string
  api_username: string
  api_password: string
  camera_provider: string
  camera_api_base_url: string
  camera_device_id: string
  asset_provider: string
  asset_index_url: string
}

interface EventForm {
  event_type: string
  event_date: string
  details: Record<string, unknown>
  source: string
}

const eventTypes = ['sowing', 'transplanting', 'fertilization', 'pesticide_application', 'irrigation', 'drainage', 'drying_field', 'weeding', 'field_observation', 'pest_observation', 'disease_observation', 'disaster_event', 'harvest', 'other']

interface EventDetailField { key: string; type?: 'number'; multiline?: boolean }

const eventDetailFields: Record<string, EventDetailField[]> = {
  sowing: [{ key: 'variety' }, { key: 'seed_rate', type: 'number' }, { key: 'seed_rate_unit' }, { key: 'note' }],
  transplanting: [{ key: 'variety' }, { key: 'seedling_age' }, { key: 'density' }, { key: 'note' }],
  fertilization: [{ key: 'product_name' }, { key: 'dose', type: 'number' }, { key: 'dose_unit' }, { key: 'application_method' }, { key: 'note' }],
  pesticide_application: [{ key: 'product_name' }, { key: 'target' }, { key: 'purpose' }, { key: 'dose', type: 'number' }, { key: 'dose_unit' }, { key: 'application_method' }, { key: 'note' }],
  irrigation: [{ key: 'water_depth' }, { key: 'duration' }, { key: 'note' }], drainage: [{ key: 'water_depth' }, { key: 'duration' }, { key: 'note' }], drying_field: [{ key: 'duration' }, { key: 'field_condition' }, { key: 'note' }], weeding: [{ key: 'product_name' }, { key: 'dose', type: 'number' }, { key: 'dose_unit' }, { key: 'note' }], field_observation: [{ key: 'tiller_density' }, { key: 'plant_height' }, { key: 'leaf_color' }, { key: 'water_level' }, { key: 'note' }], pest_observation: [{ key: 'target' }, { key: 'severity' }, { key: 'affected_area' }, { key: 'note' }], disease_observation: [{ key: 'target' }, { key: 'severity' }, { key: 'affected_area' }, { key: 'note' }], disaster_event: [{ key: 'disaster_type' }, { key: 'severity' }, { key: 'impact' }, { key: 'note' }], harvest: [{ key: 'yield', type: 'number' }, { key: 'yield_unit' }, { key: 'quality' }, { key: 'note' }], other: [{ key: 'note' }],
}

const emptyField = (): FieldConfig => ({
  project_name: '', field_name: '', location: '', latitude: '', longitude: '', planting_area: '', planted_variety: '', sowing_date: '', transplant_date: '',
  cultivation_method: '', season_type: '', target_yield: '', soil_info: '', irrigation_condition: '', sensor_provider: '', platform_name: '', api_base_url: '',
  device_addr: '', api_username: '', api_password: '', camera_provider: '', camera_api_base_url: '', camera_device_id: '', asset_provider: '', asset_index_url: '',
})

const emptyEvent = (): EventForm => ({ event_type: 'other', event_date: '', details: { note: '' }, source: 'manual' })
const keyOf = (field: FieldConfig): string => field.storage_name || field.project_name || field.field_name
const visibleDetails = (event: EventForm): EventDetailField[] => {
  const fixed = eventDetailFields[event.event_type] ?? eventDetailFields.other ?? []
  const known = new Set(fixed.map(field => field.key))
  return [...fixed, ...Object.keys(event.details).filter(key => !known.has(key)).map(key => ({ key, multiline: Array.isArray(event.details[key]) }))]
}
const detailValue = (value: unknown): string => Array.isArray(value) ? value.join('、') : String(value ?? '')

/** Edit local field profiles, connections, and recorded farm events. */
export function FieldManagementSettings({ t }: PropsRuntime<'settings.section'> & PropsLocale<'settings.pluginInventory'>): ReactNode {
  const text = (key: PluginInventoryLocaleKey): string => t(key)
  const [fields, setFields] = useState<FieldConfig[]>([])
  const [events, setEvents] = useState<Record<string, EventForm[]>>({})
  const [status, setStatus] = useState(() => text('field.loading'))

  useEffect(() => {
    void fetch('/_lucarice/fields').then(async response => {
      if (!response.ok) throw new Error(await response.text())
      return response.json() as Promise<{ fields: FieldConfig[] }>
    }).then(async ({ fields: loaded }) => {
      const entries = await Promise.all(loaded.map(async field => {
        const response = await fetch('/_lucarice/field-data', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'events', field: field.project_name }),
        })
        if (!response.ok) throw new Error(await response.text())
        const value = await response.json() as { events: EventForm[] }
        return [keyOf(field), value.events] as const
      }))
      setFields(loaded)
      setEvents(Object.fromEntries(entries))
      setStatus('')
    }).catch(() => { setStatus(text('field.error')) })
  }, [])

  const update = (index: number, key: keyof FieldConfig, value: string): void => {
    setFields(current => current.map((field, currentIndex) => currentIndex === index ? { ...field, [key]: value } : field))
  }

  const updateEvent = (fieldKey: string, index: number, key: keyof EventForm, value: string): void => {
    setEvents(current => ({ ...current, [fieldKey]: (current[fieldKey] ?? []).map((event, currentIndex) => currentIndex === index ? { ...event, [key]: value } : event) }))
  }

  const updateEventDetail = (fieldKey: string, index: number, key: string, value: string): void => {
    setEvents(current => ({ ...current, [fieldKey]: (current[fieldKey] ?? []).map((event, currentIndex) => currentIndex === index ? { ...event, details: { ...event.details, [key]: value } } : event) }))
  }

  const refreshEvents = (field: FieldConfig): void => {
    setStatus(text('field.refreshing'))
    void fetch('/_lucarice/field-data', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'events', field: field.project_name }),
    }).then(async response => {
      if (!response.ok) throw new Error(await response.text())
      const value = await response.json() as { events: EventForm[] }
      setEvents(current => ({ ...current, [keyOf(field)]: value.events }))
      setStatus(text('field.refreshed'))
    }, () => { setStatus(text('field.refreshFailed')) })
  }

  const save = (): void => {
    const savedEvents = events
    setStatus(text('field.saving'))
    void fetch('/_lucarice/fields', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }),
    }).then(async response => {
      if (!response.ok) throw new Error(await response.text())
      const value = await response.json() as { fields: FieldConfig[] }
      await Promise.all(value.fields.map(field => fetch('/_lucarice/events', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: field.project_name, events: savedEvents[keyOf(field)] ?? [] }),
      })))
      setFields(value.fields)
      setStatus(text('field.saved'))
    }, () => { setStatus(text('field.saveFailed')) })
  }

  return (
    <div className={css.section}>
      <p className={css.help}>{text('field.help')}</p>
      {fields.map((field, index) => {
        const fieldKey = keyOf(field)
        return (
          <section className={css.card} key={fieldKey || index}>
            <div className={css.cardHeader}>
              <strong>{text('field.card').replace('{index}', String(index + 1))}</strong>
              <button type="button" onClick={() => { setFields(current => current.filter((_, currentIndex) => currentIndex !== index)); setEvents(current => { const next = { ...current }; delete next[fieldKey]; return next }) }}>{text('field.deleteField')}</button>
            </div>
            <h3 className={css.heading}>{text('field.profile')}</h3>
            <div className={css.grid}>
              <label>{text('field.projectName')}<input value={field.project_name} onChange={event => { update(index, 'project_name', event.currentTarget.value) }} /></label><label>{text('field.fieldName')}<input value={field.field_name} onChange={event => { update(index, 'field_name', event.currentTarget.value) }} /></label><label>{text('field.location')}<input value={field.location} onChange={event => { update(index, 'location', event.currentTarget.value) }} /></label><label>{text('field.area')}<input placeholder={text('field.exampleArea')} value={field.planting_area} onChange={event => { update(index, 'planting_area', event.currentTarget.value) }} /></label><label>{text('field.variety')}<input value={field.planted_variety} onChange={event => { update(index, 'planted_variety', event.currentTarget.value) }} /></label><label>{text('field.sowingDate')}<input type="date" value={field.sowing_date} onChange={event => { update(index, 'sowing_date', event.currentTarget.value) }} /></label><label>{text('field.transplantDate')}<input type="date" value={field.transplant_date} onChange={event => { update(index, 'transplant_date', event.currentTarget.value) }} /></label><label>{text('field.method')}<input placeholder={text('field.exampleMethod')} value={field.cultivation_method} onChange={event => { update(index, 'cultivation_method', event.currentTarget.value) }} /></label><label>{text('field.season')}<input placeholder={text('field.exampleSeason')} value={field.season_type} onChange={event => { update(index, 'season_type', event.currentTarget.value) }} /></label><label>{text('field.targetYield')}<input placeholder={text('field.exampleYield')} value={field.target_yield} onChange={event => { update(index, 'target_yield', event.currentTarget.value) }} /></label><label className={css.wide}>{text('field.soil')}<input value={field.soil_info} onChange={event => { update(index, 'soil_info', event.currentTarget.value) }} /></label><label className={css.wide}>{text('field.irrigation')}<input value={field.irrigation_condition} onChange={event => { update(index, 'irrigation_condition', event.currentTarget.value) }} /></label><label>{text('field.latitude')}<input value={field.latitude} onChange={event => { update(index, 'latitude', event.currentTarget.value) }} /></label><label>{text('field.longitude')}<input value={field.longitude} onChange={event => { update(index, 'longitude', event.currentTarget.value) }} /></label>
            </div>
            <h3 className={css.heading}>{text('field.sources')}</h3>
            <div className={css.grid}>
              <label>{text('field.sensorProvider')}<input placeholder={text('field.exampleSensor')} value={field.sensor_provider} onChange={event => { update(index, 'sensor_provider', event.currentTarget.value) }} /></label><label>{text('field.platform')}<input value={field.platform_name} onChange={event => { update(index, 'platform_name', event.currentTarget.value) }} /></label><label>{text('field.device')}<input value={field.device_addr} onChange={event => { update(index, 'device_addr', event.currentTarget.value) }} /></label><label className={css.wide}>{text('field.apiUrl')}<input value={field.api_base_url} onChange={event => { update(index, 'api_base_url', event.currentTarget.value) }} /></label><label>{text('field.apiUser')}<input value={field.api_username} onChange={event => { update(index, 'api_username', event.currentTarget.value) }} /></label><label>{text('field.apiPassword')}<input type="password" value={field.api_password} onChange={event => { update(index, 'api_password', event.currentTarget.value) }} /></label><label>{text('field.cameraProvider')}<input placeholder={text('field.exampleCamera')} value={field.camera_provider} onChange={event => { update(index, 'camera_provider', event.currentTarget.value) }} /></label><label>{text('field.cameraDevice')}<input value={field.camera_device_id} onChange={event => { update(index, 'camera_device_id', event.currentTarget.value) }} /></label><label className={css.wide}>{text('field.cameraUrl')}<input value={field.camera_api_base_url} onChange={event => { update(index, 'camera_api_base_url', event.currentTarget.value) }} /></label><label>{text('field.assetProvider')}<input placeholder={text('field.exampleAsset')} value={field.asset_provider} onChange={event => { update(index, 'asset_provider', event.currentTarget.value) }} /></label><label className={css.wide}>{text('field.assetIndex')}<input placeholder={text('field.exampleAssetIndex')} value={field.asset_index_url} onChange={event => { update(index, 'asset_index_url', event.currentTarget.value) }} /></label>
            </div>
            <div className={css.timelineHeader}>
              <h3 className={css.heading}>{text('field.timeline')}</h3>
              <button type="button" onClick={() => { refreshEvents(field) }}>{text('field.refresh')}</button>
            </div>
            {(events[fieldKey] ?? []).map((event, eventIndex) => (
              <div className={css.event} key={eventIndex}>
                <label>{text('field.date')}<input type="date" value={event.event_date} onChange={value => { updateEvent(fieldKey, eventIndex, 'event_date', value.currentTarget.value) }} /></label>
                <label>{text('field.type')}<select value={event.event_type} onChange={value => { updateEvent(fieldKey, eventIndex, 'event_type', value.currentTarget.value) }}>{eventTypes.map(value => <option key={value} value={value}>{text(`field.event.${value}` as PluginInventoryLocaleKey)}</option>)}</select></label>
                <label>{text('field.source')}<input value={event.source} disabled /></label>
                {visibleDetails(event).map(detail => (
                  <label key={detail.key}>{text(`field.detail.${detail.key}` as PluginInventoryLocaleKey)}{detail.multiline
                    ? <textarea value={detailValue(event.details[detail.key])} onChange={value => { updateEventDetail(fieldKey, eventIndex, detail.key, value.currentTarget.value) }} />
                    : <input type={detail.type ?? 'text'} value={detailValue(event.details[detail.key])} onChange={value => { updateEventDetail(fieldKey, eventIndex, detail.key, value.currentTarget.value) }} />}</label>
                ))}
                <button type="button" onClick={() => { setEvents(current => ({ ...current, [fieldKey]: (current[fieldKey] ?? []).filter((_, currentIndex) => currentIndex !== eventIndex) })) }}>{text('field.deleteRecord')}</button>
              </div>
            ))}
            <button type="button" className={css.addEvent} onClick={() => { setEvents(current => ({ ...current, [fieldKey]: [...(current[fieldKey] ?? []), emptyEvent()] })) }}>{text('field.addRecord')}</button>
          </section>
        )
      })}
      <div className={css.actions}>
        <button type="button" onClick={() => { setFields(current => [...current, emptyField()]) }}>{text('field.addField')}</button>
        <button type="button" className={css.save} onClick={save}>{text('field.save')}</button>
        {status === '' ? null : <span>{status}</span>}
      </div>
    </div>
  )
}
