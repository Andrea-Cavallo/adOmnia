/**
 * Classe `main` di una configurazione Java ricavata dagli argomenti del comando: la proposta "Main Class"
 * esegue `exec:java -Dexec.mainClass=…`, e quella è anche la classe da debuggare. Vuoto se non c'è.
 */
export function javaMainClassOf(programArguments: readonly string[]): string {
  const prefix = '-Dexec.mainClass='
  const argument = programArguments.find((item) => item.startsWith(prefix))
  const name = argument ? argument.slice(prefix.length) : ''
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name) ? name : ''
}
