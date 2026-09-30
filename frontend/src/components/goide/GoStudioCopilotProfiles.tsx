import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ProfileType } from '../../../bindings/adomnia/internal/copilot/models'
import type { CopilotProfile, CopilotSettings } from '@/lib/copilot-api'

const INPUT = 'h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent'
const LABEL = 'block text-[10px] font-medium text-text-3'

const TYPE_LABEL: Record<string, string> = {
  [ProfileType.ProfileDotCom]: 'GitHub.com',
  [ProfileType.ProfileEnterpriseCloud]: 'Enterprise Cloud',
  [ProfileType.ProfileEnterpriseServer]: 'Enterprise Server',
}

interface ProfilesProps {
  draft: CopilotSettings
  onChange: (settings: CopilotSettings) => void
  projectRoot: string | null
  projectName: string | null
}

function newProfileId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'
  return `${slug}-${Date.now().toString(36)}`
}

/** Profili GitHub (github.com, *.ghe.com, GHES), profilo per questo progetto, proxy e CA aziendale. */
export function GoStudioCopilotProfiles({ draft, onChange, projectRoot, projectName }: ProfilesProps) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const update = (patch: Partial<CopilotSettings>) => onChange({ ...draft, ...patch })
  const bindings = draft.workspaceProfiles ?? {}
  const boundId = projectRoot ? bindings[projectRoot] ?? '' : ''

  const addProfile = () => {
    if (!name.trim() || !host.trim()) return
    // Il backend normalizza l'host e ricava il tipo (github.com, ghe.com o GHES) al salvataggio.
    const profile: CopilotProfile = { id: newProfileId(name), name: name.trim(), host: host.trim(), type: ProfileType.$zero }
    update({ profiles: [...draft.profiles, profile] })
    setName('')
    setHost('')
  }

  const removeProfile = (id: string) => {
    const profiles = draft.profiles.filter((profile) => profile.id !== id)
    const workspaceProfiles = Object.fromEntries(Object.entries(bindings).filter(([, profileId]) => profileId !== id))
    update({ profiles, workspaceProfiles, activeProfileId: draft.activeProfileId === id ? profiles[0]?.id ?? '' : draft.activeProfileId })
  }

  const bindProject = (id: string) => {
    if (!projectRoot) return
    const { [projectRoot]: _previous, ...rest } = bindings
    update({ workspaceProfiles: id ? { ...rest, [projectRoot]: id } : rest })
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-4">GitHub accounts</h3>
        <div className="divide-y divide-border-1 rounded border border-border-1">
          {draft.profiles.map((profile) => (
            <label key={profile.id} className="flex items-center gap-2 px-2.5 py-2 text-[11px]">
              <input type="radio" name="copilot-active-profile" checked={draft.activeProfileId === profile.id} onChange={() => update({ activeProfileId: profile.id })} className="accent-[var(--color-accent)]" />
              <span className="font-medium text-text-1">{profile.name}</span>
              <span className="truncate font-mono text-[10.5px] text-text-3">{profile.host}</span>
              {profile.type && <span className="ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-text-3">{TYPE_LABEL[profile.type] ?? profile.type}</span>}
              <button type="button" disabled={draft.profiles.length === 1} onClick={() => removeProfile(profile.id)} aria-label={`Remove ${profile.name}`} title="Remove profile" className={`${profile.type ? '' : 'ml-auto'} grid h-6 w-6 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-danger disabled:opacity-30`}><Trash2 size={12} /></button>
            </label>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className={`${LABEL} w-32`}>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Work" className={`${INPUT} mt-1`} /></label>
          <label className={`${LABEL} flex-1`}>GitHub host<input value={host} onChange={(event) => setHost(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addProfile() }} placeholder="github.com · company.ghe.com · github.company.internal" className={`${INPUT} mt-1 font-mono`} /></label>
          <button type="button" disabled={!name.trim() || !host.trim()} onClick={addProfile} className="flex h-8 shrink-0 items-center gap-1 rounded border border-border-2 bg-surface-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-3 disabled:opacity-40"><Plus size={12} /> Add</button>
        </div>
      </section>

      {projectRoot && (
        <label className={LABEL}>Account for {projectName ?? 'this project'}
          <select value={boundId} onChange={(event) => bindProject(event.target.value)} className={`${INPUT} mt-1`}>
            <option value="">Default account ({draft.profiles.find((profile) => profile.id === draft.activeProfileId)?.name ?? '—'})</option>
            {draft.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} — {profile.host}</option>)}
          </select>
          <span className="mt-1 block text-[9.5px] leading-4 text-text-4">Remembered for this project, so company code never uses your personal account by mistake.</span>
        </label>
      )}

      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Network</h3>
        <label className={LABEL}>HTTP proxy
          <input value={draft.proxy.url} onChange={(event) => update({ proxy: { ...draft.proxy, url: event.target.value } })} placeholder="System proxy · http://proxy.company.local:8080" className={`${INPUT} mt-1 font-mono`} />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-text-2">
          <input type="checkbox" checked={draft.proxy.strictSSL} onChange={(event) => update({ proxy: { ...draft.proxy, strictSSL: event.target.checked } })} className="accent-[var(--color-accent)]" />
          Verify proxy TLS certificates (recommended)
        </label>
        <label className={LABEL}>Company CA bundle (PEM)
          <input value={draft.caBundlePath} onChange={(event) => update({ caBundlePath: event.target.value })} placeholder="System certificates only · /etc/ssl/company-ca.pem" className={`${INPUT} mt-1 font-mono`} />
          <span className="mt-1 block text-[9.5px] leading-4 text-text-4">Added to the system trust store for TLS inspection proxies. Certificate checks are never disabled.</span>
        </label>
      </section>
    </div>
  )
}
