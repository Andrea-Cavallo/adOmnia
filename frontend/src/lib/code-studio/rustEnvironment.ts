/** Dimensione leggibile per la cache dell'analizzatore (RS-2). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'empty'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // Sotto i 10 KB un decimale non aggiunge nulla; sopra serve per non dire "2 GB" quando sono 2,7.
  const decimals = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[unit]}`
}

/** Aliases, `[env]` e `[target.*]` del `.cargo/config.toml` in righe ordinate per la vista. */
export function environmentRows(environment: {
  cargoHome?: string
  rustupHome?: string
  targetDir?: string
  rustFlags?: string
  aliases?: { readonly [name: string]: string | undefined } | null
  env?: { readonly [name: string]: string | undefined } | null
  targets?: { readonly [triple: string]: { runner?: string; linker?: string } | undefined } | null
}): Array<{ key: string; value: string; source: string }> {
  const rows = [
    { key: 'CARGO_HOME', value: environment.cargoHome ?? '', source: 'environment' },
    { key: 'RUSTUP_HOME', value: environment.rustupHome ?? '', source: 'environment' },
    { key: 'CARGO_TARGET_DIR', value: environment.targetDir ?? '', source: environment.targetDir ? 'config/.cargo' : 'default target/' },
    { key: 'RUSTFLAGS', value: environment.rustFlags ?? '', source: 'environment' },
  ]
  for (const [name, command] of Object.entries(environment.aliases ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    rows.push({ key: `alias ${name}`, value: command ?? '', source: '[alias]' })
  }
  for (const [name, value] of Object.entries(environment.env ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    rows.push({ key: name, value: value ?? '', source: '[env]' })
  }
  for (const [triple, config] of Object.entries(environment.targets ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (!config) continue
    const parts = [config.runner ? `runner ${config.runner}` : '', config.linker ? `linker ${config.linker}` : ''].filter(Boolean)
    if (parts.length > 0) rows.push({ key: `target ${triple}`, value: parts.join(' · '), source: '[target.*]' })
  }
  return rows
}
