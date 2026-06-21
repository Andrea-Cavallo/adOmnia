import { useEffect, useMemo, useState } from 'react'
import { GitPullRequest, GitPullRequestArrow, KeyRound, Sparkles, Trash2 } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'
import { encryptToVaultRef, isVaultRef, resolveSecret } from '@/lib/vaultRefs'
import { generatePullRequestDraft } from '@/lib/git/aiPullRequest'
import { loadGitProfiles, matchingGitProfile, removeGitProfile, saveGitProfile, type GitProfile } from '@/lib/gitProfiles'

interface Props {
  repoPath: string
  currentBranch: string
  branches: Array<{ name: string; remote: boolean; current: boolean }>
  remotes: Array<{ name: string; url: string }>
  loading: boolean
}

const field = 'h-8 min-w-0 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent'
const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2.5 text-xs font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1 disabled:opacity-40'

function shortBranch(value: string) { return value.replace(/^remotes\//, '').replace(/^origin\//, '') }
function openExternal(url: string) {
  import('@/wailsjs/runtime/runtime').then(({ BrowserOpenURL }) => BrowserOpenURL(url)).catch(() => window.open(url, '_blank'))
}

function blankProfile(): Omit<GitProfile, 'id'> {
  return { label: '', name: '', email: '', hostPattern: 'github.com', autoApply: true, provider: 'github', baseURL: '', username: '', tokenRef: '' }
}

export function GitCollaborationSection({ repoPath, currentBranch, branches, remotes, loading }: Props) {
  const [profiles, setProfiles] = useState<GitProfile[]>(() => loadGitProfiles())
  const [selectedID, setSelectedID] = useState('')
  const [draft, setDraft] = useState(blankProfile)
  const [tokenInput, setTokenInput] = useState(() => localStorage.getItem('adomnia.git.githubToken') ?? '')
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [connectedAs, setConnectedAs] = useState('')
  const [prs, setPRs] = useState<GitSync.GitHubPR[]>([])
  const [title, setTitle] = useState('')
  const [base, setBase] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const suggestedBase = useMemo(() => {
    const names = branches.map((item) => item.name)
    return names.find((name) => /(^|\/)main$/.test(name)) || names.find((name) => /(^|\/)master$/.test(name)) || ''
  }, [branches])

  useEffect(() => { if (!base && suggestedBase) setBase(shortBranch(suggestedBase)) }, [base, suggestedBase])

  useEffect(() => {
    const match = matchingGitProfile(profiles, remotes.map((remote) => remote.url))
    if (!match) return
    setSelectedID(match.id); setDraft({ ...match }); setTokenInput(match.tokenRef); setConnectedAs(''); setPRs([])
    if (repoPath && match.name && match.email) void GitSync.ConfigureUser(repoPath, match.name, match.email).catch(() => undefined)
  }, [profiles, remotes, repoPath])

  const account = { provider: draft.provider, baseURL: draft.baseURL, username: draft.username }
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(''); setNotice('')
    try { await fn() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy('') }
  }
  const resolvedToken = () => resolveSecret(tokenInput || draft.tokenRef)

  const chooseProfile = (id: string) => {
    setSelectedID(id); setConnectedAs(''); setPRs([])
    const profile = profiles.find((item) => item.id === id)
    if (profile) { setDraft({ ...profile }); setTokenInput(profile.tokenRef) } else { setDraft(blankProfile()); setTokenInput('') }
  }

  const saveAccount = () => run('save', async () => {
    const tokenRef = tokenInput.trim()
    const next = saveGitProfile(profiles, { ...draft, id: selectedID || undefined, tokenRef })
    setProfiles(next); setSelectedID(next[0].id); setDraft({ ...next[0] })
    localStorage.removeItem('adomnia.git.githubToken')
    if (repoPath && draft.name && draft.email) await GitSync.ConfigureUser(repoPath, draft.name, draft.email)
    setNotice(isVaultRef(tokenRef) ? 'Account saved. The token stays encrypted in Vault.' : 'Account saved locally. Use Encrypt token to protect the credential at rest.')
  })

  const encryptToken = () => run('encrypt', async () => {
    if (isVaultRef(tokenInput)) { setNotice('This token is already protected by Vault.'); return }
    const ref = await encryptToVaultRef(tokenInput.trim(), vaultPassphrase)
    setTokenInput(ref); setDraft((current) => ({ ...current, tokenRef: ref })); setVaultPassphrase('')
    setNotice('Token encrypted. Save the account to persist the Vault reference.')
  })

  const connect = () => run('connect', async () => {
    const token = await resolvedToken()
    const login = await GitSync.HostValidateToken(repoPath, account, token)
    setConnectedAs(login || draft.label)
    setPRs(await GitSync.HostListPRs(repoPath, account, token))
  })

  const generate = () => run('ai', async () => {
    const target = base.trim()
    if (!target) throw new Error('Choose a base branch before generating the description.')
    const diff = await GitSync.CreatePatch(repoPath, `${target}...${currentBranch}`, '')
    const result = await generatePullRequestDraft({ branch: currentBranch, base: target, diff })
    setTitle(result.title); setBody(result.body); setNotice('AI draft generated locally from the selected branch diff. Review it before opening the PR.')
  })

  const create = () => run('create', async () => {
    const token = await resolvedToken()
    const pr = await GitSync.HostCreatePR(repoPath, account, token, title.trim(), currentBranch, base.trim(), body.trim())
    setPRs((current) => [pr, ...current.filter((item) => item.number !== pr.number)])
    setNotice(`Pull request #${pr.number} opened.`)
  })

  const pushWithAccount = () => run('push', async () => {
    await GitSync.HostPush(repoPath, account, await resolvedToken(), currentBranch)
    setNotice(`Pushed ${currentBranch} with the selected ${draft.provider} account.`)
  })

  return (
    <section className="min-w-0 rounded border border-border-1 bg-surface-1 xl:col-span-2">
      <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-4"><GitPullRequest size={13} /> Collaboration accounts & pull requests</div>
      <div className="grid gap-3 p-3 2xl:grid-cols-[.9fr_1.1fr]">
        <div className="space-y-2 border-b border-border-1 pb-3 2xl:border-b-0 2xl:border-r 2xl:pb-0 2xl:pr-3">
          <div className="grid gap-2 md:grid-cols-[1fr_130px]">
            <select value={selectedID} onChange={(event) => chooseProfile(event.target.value)} className={field}><option value="">New host account…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.provider}</option>)}</select>
            <select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as GitProfile['provider'] }))} className={field}><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="bitbucket">Bitbucket</option><option value="azure">Azure DevOps</option></select>
          </div>
          <div className="grid gap-2 md:grid-cols-2"><input value={draft.label} onChange={(e) => setDraft((c) => ({ ...c, label:e.target.value }))} className={field} placeholder="Account label" /><input value={draft.hostPattern} onChange={(e) => setDraft((c) => ({ ...c, hostPattern:e.target.value }))} className={field} placeholder="Remote host match" /></div>
          <input value={draft.baseURL} onChange={(e) => setDraft((c) => ({ ...c, baseURL:e.target.value }))} className={`${field} w-full`} placeholder="Custom API base URL (optional / self-hosted)" />
          <div className="grid gap-2 md:grid-cols-3"><input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name:e.target.value }))} className={field} placeholder="Git author name" /><input value={draft.email} onChange={(e) => setDraft((c) => ({ ...c, email:e.target.value }))} className={field} placeholder="Git author email" /><input value={draft.username} onChange={(e) => setDraft((c) => ({ ...c, username:e.target.value }))} className={field} placeholder="Host username (Bitbucket app password)" /></div>
          <div className="grid gap-2 md:grid-cols-[1fr_150px_auto]"><input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} type="password" className={field} placeholder="PAT, access token, or vault: reference" autoComplete="off" /><input value={vaultPassphrase} onChange={(e) => setVaultPassphrase(e.target.value)} type="password" className={field} placeholder="Vault passphrase" /><button className={button} disabled={!tokenInput || isVaultRef(tokenInput) || !vaultPassphrase || !!busy} onClick={encryptToken}><KeyRound size={12} /> Encrypt token</button></div>
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1.5 text-[10px] text-text-2"><input type="checkbox" checked={draft.autoApply} onChange={(e) => setDraft((c) => ({ ...c, autoApply:e.target.checked }))} /> Auto-select for matching remote</label><button className={button} disabled={!draft.label.trim() || !draft.hostPattern.trim() || !tokenInput.trim() || !!busy} onClick={saveAccount}>Save account</button>{selectedID && <button className={cn(button, 'text-error')} disabled={!!busy} onClick={() => { const next = removeGitProfile(profiles, selectedID); setProfiles(next); chooseProfile('') }}><Trash2 size={12} /> Remove</button>}</div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><button className={cn(button, 'border-accent bg-accent text-white hover:bg-accent-light hover:text-white')} disabled={!repoPath || !tokenInput.trim() || !!busy} onClick={connect}>{connectedAs ? `Connected: ${connectedAs}` : 'Connect account'}</button><button className={button} disabled={!connectedAs || !currentBranch || !!busy} onClick={pushWithAccount}>Push with account</button><span className="text-[10px] text-text-4">{draft.provider} · auto-selected from origin when the host matches</span></div>
          <div className="grid gap-2 md:grid-cols-[1fr_150px_auto]"><input value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="Pull request title" /><input value={base} onChange={(e) => setBase(e.target.value)} className={field} placeholder="Base branch" /><button className={button} disabled={!repoPath || !currentBranch || !base.trim() || !!busy} onClick={generate}><Sparkles size={12} className={busy === 'ai' ? 'animate-pulse' : ''} /> Generate with AI</button></div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className={`${field} h-24 w-full resize-y py-2`} placeholder="Pull request description" />
          <div className="flex gap-2"><button className={cn(button, 'border-accent bg-accent text-white hover:bg-accent-light hover:text-white')} disabled={!connectedAs || !title.trim() || !base.trim() || loading || !!busy} onClick={create}>Open PR from “{shortBranch(currentBranch) || '—'}”</button><button className={button} disabled={!connectedAs || !!busy} onClick={() => run('refresh', async () => setPRs(await GitSync.HostListPRs(repoPath, account, await resolvedToken())))}>Refresh</button></div>
          <div className="max-h-36 space-y-1.5 overflow-y-auto">{prs.length === 0 ? <div className="rounded border border-dashed border-border-2 p-2 text-center text-[10px] text-text-4">No open pull requests loaded</div> : prs.map((pr) => <button key={pr.number} className="flex w-full items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left hover:border-accent" onClick={() => openExternal(pr.url)}><GitPullRequestArrow size={13} className="text-success" /><span className="text-[10px] text-text-4">#{pr.number}</span><span className="min-w-0 flex-1 truncate text-xs text-text-1">{pr.draft ? '[draft] ' : ''}{pr.title}</span><span className="text-[10px] text-text-4">{shortBranch(pr.head)} → {pr.base}</span></button>)}</div>
        </div>
      </div>
      {(error || notice) && <div className={cn('mx-3 mb-3 rounded border px-2 py-1.5 text-[10px]', error ? 'border-error/40 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')}>{error || notice}</div>}
    </section>
  )
}
