/** A manifest whose dependencies the Python environment plan can install. */
export function isPythonDependencyManifest(name: string): boolean {
  return /^requirements([.-].+)?\.txt$/i.test(name) || name === 'pyproject.toml'
}

/** Unit directory of a manifest: `api/requirements.txt` → `api`, root manifest → ''. */
export function pythonUnitOfManifest(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const cut = normalized.lastIndexOf('/')
  return cut < 0 ? '' : normalized.slice(0, cut)
}
