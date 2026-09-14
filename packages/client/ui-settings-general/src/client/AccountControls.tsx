import { useEffect, useState, type FormEvent } from 'react'
import { IconEllipsisOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AccountControls.module.css'

type Account = { username: string; role: 'admin' | 'user'; enabled?: boolean }
type ServiceState = { id: string; online: boolean }

function logout(): void {
  void fetch('/_lucarice/auth/logout', { method: 'POST' }).then(() => { window.location.reload() })
}

export function AccountFooter({ wide, t }: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'settings'>) {
  const [account, setAccount] = useState<Account>()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void fetch('/_lucarice/auth/me').then(async response => {
      if (!response.ok) return
      const body = await response.json() as { user?: Account }
      setAccount(body.user)
    })
  }, [])
  if (account === undefined) return null
  const avatar = account.username.slice(0, 1).toUpperCase()
  return <div className={`${css.footer} ${wide ? '' : css.footerCompact}`}>
    {open ? <div className={css.footerMenu}>
      <button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('lucarice:open-settings', { detail: { section: 'account' } })) }} className={css.footerMenuAction}><IconSettingsOutline16 size={20} />{t('account.settings')}</button>
      <button type="button" onClick={logout} className={css.footerMenuAction}><span style={{ width: 20, textAlign: 'center', fontSize: 22 }}>↪</span>{t('account.logout')}</button>
    </div> : null}
    <button type="button" onClick={() => { setOpen(!open) }} className={`${css.footerButton} ${wide ? '' : css.footerButtonCompact}`}>
      <span className={css.footerAvatar}>{avatar}</span>
      {wide ? <><span className={css.footerName}>{account.username}</span><IconEllipsisOutline16 size={18} /></> : null}
    </button>
  </div>
}

export function AccountSection({ t }: PropsRuntime<'settings.section'> & PropsLocale<'settings'>) {
  const [account, setAccount] = useState<Account>()
  const [users, setUsers] = useState<Account[]>([])
  const [services, setServices] = useState<ServiceState[]>([])
  const [createName, setCreateName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [target, setTarget] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState('')
  const load = () => {
    void fetch('/_lucarice/auth/me').then(async response => {
      if (!response.ok) return
      const body = await response.json() as { user?: Account }
      if (body.user === undefined) return
      setAccount(body.user)
      setTarget(body.user.username)
      if (body.user.role === 'admin') {
        const list = await fetch('/_lucarice/auth/users')
        const listBody = await list.json() as { users?: Account[] }
        setUsers(listBody.users ?? [])
        const serviceList = await fetch('/_lucarice/auth/services')
        const serviceBody = await serviceList.json() as { services?: ServiceState[] }
        setServices(serviceBody.services ?? [])
      }
    })
  }
  useEffect(load, [])
  const createUser = (event: FormEvent) => {
    event.preventDefault()
    void fetch('/_lucarice/auth/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: createName, password: createPassword }) }).then(async response => {
      const body = await response.json() as { error?: string }
      setNotice(response.ok ? `${t('account.users.created')} ${createName}` : body.error ?? t('account.users.failed'))
      if (response.ok) { setCreateName(''); setCreatePassword(''); load() }
    })
  }
  const updatePassword = (event: FormEvent) => {
    event.preventDefault()
    if (account === undefined) return
    const self = target === account.username
    void fetch('/_lucarice/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(account.role === 'admin' ? { username: target } : {}), password: newPassword }) }).then(async response => {
      const body = await response.json() as { error?: string }
      setNotice(response.ok ? t('account.password.updated') : body.error ?? t('account.password.failed'))
      if (response.ok && self) logout()
      if (response.ok) setNewPassword('')
    })
  }
  const setUserEnabled = (user: Account, enabled: boolean) => {
    void fetch('/_lucarice/auth/users/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user.username, enabled }),
    }).then(async response => {
      const body = await response.json() as { error?: string }
      setNotice(response.ok
        ? enabled ? t('account.users.enabled') : t('account.users.disabled')
        : body.error ?? t('account.users.statusFailed'))
      if (response.ok) load()
    })
  }
  if (account === undefined) return <div className={css.page}>{t('account.loading')}</div>
  const role = account.role === 'admin' ? t('account.role.admin') : t('account.role.user')
  return <div className={css.page}>
    <section className={css.profile}>
      <div className={css.avatar}>{account.username.slice(0, 1).toUpperCase()}</div>
      <div className={css.profileText}><div className={css.profileName}>{account.username}</div><div className={css.profileMeta}>{t('account.profile')}</div></div>
      <div className={css.role}>{role}</div>
    </section>
    <section className={css.card}>
      <div className={css.cardHeader}><div className={css.cardTitle}>{t('account.password.title')}</div><div className={css.cardHint}>{account.role === 'admin' ? t('account.password.adminHint') : t('account.password.userHint')}</div></div>
      <form onSubmit={updatePassword} className={css.form}>
        {account.role === 'admin' ? <label className={css.field}><span className={css.fieldLabel}>{t('account.password.select')}</span><select className={css.control} value={target} onChange={event => { setTarget(event.currentTarget.value) }}>
          {users.map(user => <option key={user.username} value={user.username}>{user.username} ({user.role === 'admin' ? t('account.role.admin') : t('account.role.user')})</option>)}
        </select></label> : null}
        <label className={css.field}><span className={css.fieldLabel}>{t('account.password.new')}</span><input required className={css.control} type="password" placeholder={t('account.password.placeholder')} value={newPassword} onChange={event => { setNewPassword(event.currentTarget.value) }} /></label>
        <div className={css.actions}><button type="submit" className={css.primary}>{t('account.password.save')}</button></div>
      </form>
    </section>
    {account.role !== 'admin' ? null : <section className={css.card}>
      <div className={css.cardHeader}><div className={css.cardTitle}>{t('account.users.title')}</div><div className={css.cardHint}>{t('account.users.registered')} {users.length}{t('account.users.countSuffix')}</div></div>
      <div className={css.userList}>{users.map(user => <div key={user.username} className={css.userRow}>
        <span className={css.miniAvatar}>{user.username.slice(0, 1).toUpperCase()}</span>
        <span className={css.userName}>{user.username}</span>
        <span className={user.enabled === false ? css.userDisabled : css.userRole}>{user.enabled === false ? t('account.users.status.disabled') : user.role === 'admin' ? t('account.role.admin') : t('account.role.user')}</span>
        {user.role === 'user' ? <button type="button" className={css.secondary} onClick={() => { setUserEnabled(user, user.enabled === false) }}>{user.enabled === false ? t('account.users.enable') : t('account.users.disable')}</button> : null}
      </div>)}</div>
      <form onSubmit={createUser} className={css.form}>
        <label className={css.field}><span className={css.fieldLabel}>{t('account.users.name')}</span><input required className={css.control} placeholder={t('account.users.namePlaceholder')} value={createName} onChange={event => { setCreateName(event.currentTarget.value) }} /></label>
        <label className={css.field}><span className={css.fieldLabel}>{t('account.users.initialPassword')}</span><input required className={css.control} type="password" placeholder={t('account.password.placeholder')} value={createPassword} onChange={event => { setCreatePassword(event.currentTarget.value) }} /></label>
        <div className={css.actions}><button type="submit" className={css.primary}>{t('account.users.create')}</button></div>
      </form>
    </section>}
    {account.role !== 'admin' ? null : <section className={css.card}>
      <div className={css.cardHeader}><div className={css.cardTitle}>{t('account.services.title')}</div><div className={css.cardHint}>{t('account.services.hint')}</div></div>
      <div className={css.serviceGrid}>{services.map(service => <div key={service.id} className={css.serviceRow}>
        <span className={service.online ? css.statusOnline : css.statusOffline} />
        <span className={css.userName}>{t(`account.services.${service.id}` as Parameters<typeof t>[0])}</span>
        <span className={service.online ? css.serviceOnline : css.serviceOffline}>{service.online ? t('account.services.online') : t('account.services.offline')}</span>
      </div>)}</div>
    </section>}
    {notice === '' ? null : <div className={css.notice}>{notice}</div>}
    <button type="button" className={css.logout} onClick={logout}>{t('account.logout')}</button>
  </div>
}
