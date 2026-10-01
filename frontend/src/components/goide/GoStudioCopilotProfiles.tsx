import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ProfileType } from '../../../bindings/adomnia/internal/copilot/models'
import type { CopilotProfile, CopilotSettings } from '@/lib/copilot-api'

const INPUT = 'gs-input'
const LABEL = 'gs-field-label'

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
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">GitHub accounts</h3>
        <div className="gs-list">
          {draft.profiles.map((profile) => (
            <label key={profile.id} className="gs-list-row cursor-pointer">
              <input type="radio" name="copilot-active-profile" checked={draft.activeProfileId === profile.id} onChange={() => update({ activeProfileId: profile.id })}  />
              <span className="font-medium text-text-1">{profile.name}</span>
              <span className="gs-mono truncate text-text-3">{profile.host}</span>
              {profile.type && <span className="gs-badge ml-auto">{TYPE_LABEL[profile.type] ?? profile.type}</span>}
              <button type="button" disabled={draft.profiles.length === 1} onClick={() => removeProfile(profile.id)} aria-label={`Remove ${profile.name}`} title="Remove profile" className={`${profile.type ? '' : 'ml-auto'} gs-btn gs-btn-danger-ghost gs-btn-sm gs-btn-icon`}><Trash2 size={13} /></button>
            </label>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className={`${LABEL} w-32`}>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Work" className={INPUT} /></label>
          <label className={`${LABEL} flex-1`}>GitHub host<input value={host} onChange={(event) => setHost(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addProfile() }} placeholder="github.com · company.ghe.com · github.company.internal" className={`${INPUT} gs-mono`} /></label>
          <button type="button" disabled={!name.trim() || !host.trim()} onClick={addProfile} className="gs-btn gs-btn-secondary"><Plus size={14} /> Add</button>
        </div>
      </section>

      {projectRoot && (
        <label className={LABEL}>Account for {projectName ?? 'this project'}
          <select value={boundId} onChange={(event) => bindProject(event.target.value)} className={INPUT}>
            <option value="">Default account ({draft.profiles.find((profile) => profile.id === draft.activeProfileId)?.name ?? '—'})</option>
            {draft.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} — {profile.host}</option>)}
          </select>
          <span className="gs-hint">Remembered for this project, so company code never uses your personal account by mistake.</span>
        </label>
      )}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Network</h3>
        <label className={LABEL}>HTTP proxy
          <input value={draft.proxy.url} onChange={(event) => update({ proxy: { ...draft.proxy, url: event.target.value } })} placeholder="System proxy · http://proxy.company.local:8080" className={`${INPUT} gs-mono`} />
        </label>
        <label className="gs-check">
          <input type="checkbox" checked={draft.proxy.strictSSL} onChange={(event) => update({ proxy: { ...draft.proxy, strictSSL: event.target.checked } })}  />
          Verify proxy TLS certificates (recommended)
        </label>
        <label className={LABEL}>Company CA bundle (PEM)
          <input value={draft.caBundlePath} onChange={(event) => update({ caBundlePath: event.target.value })} placeholder="System certificates only · /etc/ssl/company-ca.pem" className={`${INPUT} gs-mono`} />
          <span className="gs-hint">Added to the system trust store for TLS inspection proxies. Certificate checks are never disabled.</span>
        </label>
      </section>
    </div>
  )
}
