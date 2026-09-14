// Hero chrome for the blank-draft phase of ConversationRoot: fish headline,
// glow backdrop, and the workspace row. Pure presentation — the resident
// composer is NOT rendered here (it keeps its own stable tree position in
// ConversationRoot so the textarea survives the hero → composer flip); CSS
// positions it over this shell's glow area during the hero phase.

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  FishLogo, IconChevronDownOutline14, IconChevronRightOutline14, IconCloseOutline16, IconDataOutline16,
  IconFolderClose16, IconFolderOpen16, IconSparkle16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/**
 * The soft blue backdrop ellipse (figma 313:14109). Rendered by the hero
 * owner (ConversationRoot), not HeroShell, so it can center on the input
 * card; the owner's className supplies all positioning.
 * @param props.className - positioning class from the owner.
 * @returns the blurred-ellipse svg element.
 */
export function HeroGlow({ className }: { className?: string | undefined }) {
  // Stable filter id so multiple hero mounts do not collide in the DOM.
  const glowFilterId = `empty-glow-${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 1051 468" fill="none" aria-hidden="true">
      <defs>
        <filter
          id={glowFilterId}
          x="0"
          y="0"
          width="1051"
          height="468"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <g filter={`url(#${glowFilterId})`}>
        <ellipse cx="525.5" cy="234" rx="425.5" ry="134" fill="#4CAF50" fillOpacity="0.1" />
      </g>
    </svg>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome (headline only; no glow, no composer, no workspace
 * row — the glow is the owner's {@link HeroGlow}).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, children }: HeroShellProps) {
  const clicks = useRef(0)
  const [slogan, setSlogan] = useState(0)
  const headlines = [t('hero.headline'), t('hero.easter.goal'), t('hero.easter.universe')]

  const changeHeadline = (): void => {
    clicks.current += 1
    if (clicks.current !== 3) return
    clicks.current = 0
    setSlogan(current => (current + 1) % headlines.length)
  }

  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <button type="button" className={css.fishHitbox} onClick={changeHeadline}>
            <FishLogo size={34} className={css.fish} />
          </button>
          <span className={css.headlineText}>{headlines[slogan]}</span>
        </div>
        <div className={css.body}>
          {/* The resident composer (ConversationRoot's root-owned scrollport;
              the workspace row rides the stack above the card) is CSS-centered
              in that scroll body during hero — see
              ConversationRoot.module.css [data-phase='hero']. */}
        </div>
      </div>
      {children}
    </div>
  )
}

interface FieldProfile {
  storage_name?: string
  project_name: string
  field_name: string
  location: string
  planting_area: string
  planted_variety: string
  sowing_date: string
  transplant_date: string
  cultivation_method: string
  season_type: string
  target_yield: string
  soil_info: string
  irrigation_condition: string
  latitude: string
  longitude: string
}

interface FieldEvent {
  event_type: string
  event_date: string
  details?: Record<string, unknown>
  source?: string
}

const fieldKey = (field: FieldProfile): string => field.storage_name || field.project_name || field.field_name

const eventNames: Record<string, string> = {
  sowing: '播种', transplanting: '插秧', fertilization: '施肥', pesticide_application: '施药',
  irrigation: '灌溉', drainage: '排水', drying_field: '晒田', weeding: '除草',
  field_observation: '田间观察', pest_observation: '虫害观察', disease_observation: '病害观察',
  disaster_event: '灾害记录', harvest: '收获', other: '其他记录',
}

const eventDescription = (event: FieldEvent): string => {
  const details = event.details ?? {}
  for (const key of ['product_name', 'target', 'note']) {
    const value = details[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

type AboutPage = 'overview' | 'tools' | 'fieldData' | 'gettingStarted' | 'team'

const ABOUT_COPY = {
  back: '返回概览',
  overview: {
    eyebrow: 'LucaRice 水稻种植指导智能体',
    title: '把田间信息，变成更清楚的下一步',
    intro: 'LucaRice 是为水稻种植设计的田间助手。当你想知道现在该做什么，可以直接描述田块、品种、生育期、天气和看到的现象；它会帮你梳理重点、判断需要留意的风险，并把建议落到下一步农事安排。',
    capabilities: [
      '从播种、育秧、移栽到抽穗、灌浆和收获，都可以结合当前生育期讨论肥水、病虫草害、长势和田间管理。',
      '先填写田块地点、面积、品种和播插日期，再记下施肥、施药、灌溉等农事，后续咨询时就不用反复说明背景。',
      '遇到天气变化，可询问短时降雨、未来预报和天气预警，并结合你的田块安排农事时间。',
      '发现叶色异常、虫害、病斑或倒伏时，可以上传清晰的近景和全景照片，让 LucaRice 先帮你看清画面中的问题。',
      '也可以上传化验单、种植记录和农技资料，或用语音说明现场情况，让重要信息更容易进入同一次咨询。',
    ],
  },
  tools: {
    eyebrow: '直接说清田里的情况', title: 'LucaRice 能帮你做什么', intro: '不需要记住功能名称。告诉 LucaRice 田块、品种、生育期和你看到的问题，它会结合可用信息给出下一步建议。',
    cards: [
      ['水稻种植咨询', '可咨询播种、育秧、移栽、分蘖、抽穗、灌浆到收获各阶段的管理，也可询问肥水、土壤、倒伏、低温高温、病虫草害和收获贮藏。'],
      ['田块档案与农事记录', '可查看田块地点、面积、品种和播插日期；也可在确认后补充或修改档案，并记录施肥、施药、灌溉、晒田、除草、病虫害观察、灾害和收获等农事。'],
      ['天气、预警与田间监测', '可按田块或地点查询当前天气、短时降雨、未来 3 天或 7 天预报及天气预警。田块已接入设备时，还会把可用的田间监测读数作为参考。'],
      ['田间照片与影像参考', '可上传叶片、植株、穗部或田间全景照片，辅助判断画面中可见的长势和异常；已接入田块影像时，咨询该田块也会参考近期影像。照片只能反映拍到的区域。'],
      ['品种与种子资料', '可查询水稻品种的公开登记资料，按条件筛选需要的品种信息，并把符合条件的品种资料整理为表格下载。'],
      ['药剂安全核验', '可核验指定药剂是否出现在禁限用信息中，帮助你避开明显风险。实际使用前仍应核对产品标签、作物登记范围和当地植保要求。'],
      ['文档、语音与资料阅读', '可上传种植记录、化验单、农技资料等文档，协助阅读和查找其中内容；点击麦克风说出田间情况，识别出的文字会先放进输入框，确认后再发送。'],
      ['计算、日期与公开信息', '可协助做面积、用量、降雨水量等常用计算和农事日期推算；需要了解实时公开信息时，也可查询相关资料作为补充参考。'],
    ],
  },
  data: {
    eyebrow: '田块数据如何参与建议', title: '田块档案与农事记录', intro: '田块管理中的内容，会与主页中的田块管理使用同一份数据。',
    steps: [
      ['先完善田块档案', '填写地点、面积、品种、播种或插秧日期等基础信息，便于判断当前所处阶段。'],
      ['持续记录农事', '将施肥、施药、灌溉、晒田、病虫害观察等记录下来，方便回顾和追问。'],
      ['随时回看种植过程', '按时间查看已经完成的农事和田块变化；需要调整资料时，也可以在田块管理中直接编辑。'],
    ],
  },
  start: {
    eyebrow: '三步开始使用', title: '怎样问，才能得到更贴近田间的建议', intro: '信息越具体，建议越能落到下一步要做什么。',
    steps: [
      ['建好田块档案', '先在田块管理中补充品种、地点和播种或插秧日期。'],
      ['直接说清现场情况', '例如：“安仁县这块晚稻已齐穗，未来一周有雨，现在应该注意什么？”'],
      ['把关键农事记下来', '完成施肥、施药或灌溉后补一条记录，下一次咨询时就有更完整的背景。'],
    ],
  },
  team: {
    eyebrow: '湖南大学', title: '开发团队', intro: 'LucaRice 由湖南大学团队面向真实水稻生产场景研发，帮助种植者把分散的田间信息整理成更清楚、更便于行动的建议。',
    steps: [
      ['关注种植者真正关心的问题', '围绕品种、生育期、肥水、病虫害、天气和农事安排，让你能用日常语言直接描述问题。'],
      ['让田间信息更容易用起来', '把田块档案、农事记录、照片、天气和已接入的监测信息放在同一次咨询中参考，减少反复说明。'],
      ['持续完善种植体验', 'LucaRice 会持续改进对水稻生产问题的理解和呈现方式。遇到回答不清楚的地方，可以直接在对话中补充现场情况。'],
    ],
  },
} as const

/** Explain LucaRice's farming assistance in a farmer-facing, navigable view. */
function HeroAgentAbout() {
  const [page, setPage] = useState<AboutPage>('overview')

  if (page === 'tools') {
    return (
      <section className={css.aboutPage} aria-label={ABOUT_COPY.tools.title}>
        <AboutBack onClick={() => { setPage('overview') }} />
        <div className={css.aboutPageHeading}><p>{ABOUT_COPY.tools.eyebrow}</p><h3>{ABOUT_COPY.tools.title}</h3><span>{ABOUT_COPY.tools.intro}</span></div>
        <div className={css.aboutToolList}>
          {ABOUT_COPY.tools.cards.map(([title, detail]) => <AboutTool key={title} title={title} detail={detail} />)}
        </div>
      </section>
    )
  }

  if (page === 'fieldData') {
    return (
      <section className={css.aboutPage} aria-label={ABOUT_COPY.data.title}>
        <AboutBack onClick={() => { setPage('overview') }} />
        <div className={css.aboutPageHeading}><p>{ABOUT_COPY.data.eyebrow}</p><h3>{ABOUT_COPY.data.title}</h3><span>{ABOUT_COPY.data.intro}</span></div>
        <ol className={css.aboutSteps}>
          {ABOUT_COPY.data.steps.map(([title, detail], index) => <AboutStep key={title} number={String(index + 1)} title={title} detail={detail} />)}
        </ol>
      </section>
    )
  }

  if (page === 'gettingStarted') {
    return (
      <section className={css.aboutPage} aria-label={ABOUT_COPY.start.title}>
        <AboutBack onClick={() => { setPage('overview') }} />
        <div className={css.aboutPageHeading}><p>{ABOUT_COPY.start.eyebrow}</p><h3>{ABOUT_COPY.start.title}</h3><span>{ABOUT_COPY.start.intro}</span></div>
        <ol className={css.aboutSteps}>
          {ABOUT_COPY.start.steps.map(([title, detail], index) => <AboutStep key={title} number={String(index + 1)} title={title} detail={detail} />)}
        </ol>
      </section>
    )
  }

  if (page === 'team') {
    return (
      <section className={css.aboutPage} aria-label={ABOUT_COPY.team.title}>
        <AboutBack onClick={() => { setPage('overview') }} />
        <div className={css.aboutPageHeading}><p>{ABOUT_COPY.team.eyebrow}</p><h3>{ABOUT_COPY.team.title}</h3><span>{ABOUT_COPY.team.intro}</span></div>
        <ol className={css.aboutSteps}>
          {ABOUT_COPY.team.steps.map(([title, detail], index) => <AboutStep key={title} number={String(index + 1)} title={title} detail={detail} />)}
        </ol>
      </section>
    )
  }

  return (
    <section className={css.aboutPage} aria-label={ABOUT_COPY.overview.title}>
      <div className={css.aboutHero}>
        <span className={css.aboutMark}><FishLogo size={32} /></span>
        <div><p>{ABOUT_COPY.overview.eyebrow}</p><h3>{ABOUT_COPY.overview.title}</h3><span>{ABOUT_COPY.overview.intro}</span></div>
      </div>
      <div className={css.aboutFeatureGrid}>
        <button type="button" className={css.aboutFeature} onClick={() => { setPage('tools') }}>
          <span>生产工具</span><small>智能体能怎样帮你</small><IconChevronRightOutline14 size={16} />
        </button>
        <button type="button" className={css.aboutFeature} onClick={() => { setPage('fieldData') }}>
          <span>田块数据</span><small>档案和农事记录怎样使用</small><IconChevronRightOutline14 size={16} />
        </button>
        <button type="button" className={css.aboutFeature} onClick={() => { setPage('gettingStarted') }}>
          <span>开始使用</span><small>怎样提问更有效</small><IconChevronRightOutline14 size={16} />
        </button>
        <button type="button" className={css.aboutFeature} onClick={() => { setPage('team') }}>
          <span>开发团队</span><small>了解 LucaRice 的研发方向</small><IconChevronRightOutline14 size={16} />
        </button>
      </div>
      <div className={css.aboutCapabilities}>
        <h4>它能为你做什么</h4>
        <ul>
          {ABOUT_COPY.overview.capabilities.map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </section>
  )
}

function AboutBack({ onClick }: { onClick: () => void }) {
  return <button type="button" className={css.aboutBack} onClick={onClick}>‹ {ABOUT_COPY.back}</button>
}

function AboutTool({ title, detail }: { title: string; detail: string }) {
  return <article className={css.aboutTool}><h4>{title}</h4><p>{detail}</p></article>
}

function AboutStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <li><span>{number}</span><div><h4>{title}</h4><p>{detail}</p></div></li>
}

/** The hero's field view reads the same field profiles and farm records as Settings. */
function HeroFieldManagement({ t, editor }: { t: HeroTranslate; editor: ReactNode }) {
  const [fields, setFields] = useState<FieldProfile[]>([])
  const [events, setEvents] = useState<Record<string, FieldEvent[]>>({})
  const [status, setStatus] = useState(t('hero.quick.field.loading'))
  const [editing, setEditing] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    void fetch('/_lucarice/fields').then(async response => {
      if (!response.ok) throw new Error(await response.text())
      return response.json() as Promise<{ fields: FieldProfile[] }>
    }).then(async ({ fields: loaded }) => {
      const entries = await Promise.all(loaded.map(async field => {
        const response = await fetch('/_lucarice/field-data', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'events', field: field.project_name }),
        })
        if (!response.ok) throw new Error(await response.text())
        const value = await response.json() as { events: FieldEvent[] }
        return [fieldKey(field), value.events] as const
      }))
      setFields(loaded)
      setEvents(Object.fromEntries(entries))
      setStatus(loaded.length === 0 ? t('hero.quick.field.empty') : '')
    }, () => { setStatus(t('hero.quick.field.error')) })
  }, [refresh, t])

  return (
    <div className={css.fieldPanel}>
      <div className={css.fieldPanelHeader}>
        <p>{editing ? '编辑田块档案和农事记录' : '田块档案与农事记录'}</p>
        {editing
          ? <button type="button" className={css.fieldSecondaryButton} onClick={() => { setEditing(false); setRefresh(current => current + 1) }}>返回阅读</button>
          : editor !== null && <button type="button" className={css.fieldPrimaryButton} onClick={() => { setEditing(true) }}>{t('hero.quick.field.edit')}</button>}
      </div>
      {editing
        ? <div className={css.fieldSettingsEditor}>{editor}</div>
        : <>
      {status !== '' && <p className={css.fieldStatus}>{status}</p>}
      {fields.map(field => {
        const key = fieldKey(field)
        return (
          <section className={css.fieldCard} key={key}>
                  <div className={css.fieldCardHeader}>
                    <div>
                      <h3>{field.field_name || field.project_name}</h3>
                      {field.field_name !== '' && field.project_name !== '' && <p>{field.project_name}</p>}
                    </div>
                  </div>
                  <dl className={css.fieldDetails}>
                    <div><dt>{t('hero.quick.field.location')}</dt><dd>{field.location || '—'}</dd></div>
                    <div><dt>{t('hero.quick.field.area')}</dt><dd>{field.planting_area || '—'}</dd></div>
                    <div><dt>{t('hero.quick.field.variety')}</dt><dd>{field.planted_variety || '—'}</dd></div>
                    <div><dt>{field.transplant_date !== '' ? '插秧日期' : '播种日期'}</dt><dd>{field.transplant_date || field.sowing_date || '—'}</dd></div>
                  </dl>
                  <div className={css.fieldTimeline}>
                    <h4>{t('hero.quick.field.timeline')}</h4>
                    {(events[key] ?? []).length === 0
                      ? <p>{t('hero.quick.field.noEvents')}</p>
                      : (
                        <ol>
                          {[...(events[key] ?? [])].sort((a, b) => b.event_date.localeCompare(a.event_date)).map((event, eventIndex) => (
                            <li key={`${event.event_date}-${event.event_type}-${eventIndex}`}>
                              <time>{event.event_date || '—'}</time><span>{eventNames[event.event_type] ?? event.event_type}</span>{eventDescription(event) !== '' && <small>{eventDescription(event)}</small>}
                            </li>
                          ))}
                        </ol>
                      )}
                  </div>
          </section>
        )
      })}
      </>}
    </div>
  )
}

/** Quick-action cards shown beneath the blank-session composer. */
export function HeroQuickActions({ t, fieldEditor = null }: { t: HeroTranslate; fieldEditor?: ReactNode }) {
  const [dialog, setDialog] = useState<'field' | 'about' | null>(null)

  return (
    <>
      <div className={css.quickActions} aria-label={t('hero.quick.actions')}>
        <button type="button" className={css.quickAction} onClick={() => { setDialog('field') }}>
          <span className={css.quickIcon}><IconDataOutline16 size={20} /></span>
          <span className={css.quickCopy}>
            <span className={css.quickTitle}>{t('hero.quick.field.title')}</span>
            <span className={css.quickDescription}>{t('hero.quick.field.description')}</span>
          </span>
          <IconChevronRightOutline14 className={css.quickChevron} size={16} />
        </button>
        <button type="button" className={css.quickAction} onClick={() => { setDialog('about') }}>
          <span className={css.quickIcon}><IconSparkle16 size={20} /></span>
          <span className={css.quickCopy}>
            <span className={css.quickTitle}>{t('hero.quick.about.title')}</span>
            <span className={css.quickDescription}>{t('hero.quick.about.description')}</span>
          </span>
          <IconChevronRightOutline14 className={css.quickChevron} size={16} />
        </button>
      </div>
      {dialog !== null && (
        <Modal
          open
          headless
          title={dialog === 'field' ? t('hero.quick.field.title') : t('hero.quick.about.title')}
          closeLabel={t('details.close')}
          className={css.quickDialog}
          onClose={() => { setDialog(null) }}
        >
          <div className={css.quickDialogHeader}>
            <h2>{dialog === 'field' ? t('hero.quick.field.title') : t('hero.quick.about.title')}</h2>
            <button type="button" aria-label={t('details.close')} onClick={() => { setDialog(null) }}>
              <IconCloseOutline16 size={18} />
            </button>
          </div>
          <div className={css.quickDialogBody}>
            {dialog === 'field'
              ? <HeroFieldManagement t={t} editor={fieldEditor} />
              : <HeroAgentAbout />}
          </div>
        </Modal>
      )}
    </>
  )
}
