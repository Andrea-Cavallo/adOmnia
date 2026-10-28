import type { MyBatisLink } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'

export type MyBatisSide = 'java' | 'xml'

export interface MyBatisTarget {
  file: string
  line: number
  startColumn: number
  endColumn: number
}

const normalize = (path: string) => path.replace(/\\/g, '/').toLowerCase()

/** Il collegamento il cui metodo (side java) o statement (side xml) sta sulla riga indicata del file. */
export function mybatisLinkAt(links: readonly MyBatisLink[], relativePath: string, line: number, side: MyBatisSide): MyBatisLink | null {
  const path = normalize(relativePath)
  return links.find((link) => (side === 'java' ? normalize(link.javaFile ?? '') === path && link.javaLine === line : normalize(link.xmlFile ?? '') === path && link.xmlLine === line)) ?? null
}

/** Dove porta il collegamento partendo da `side`: dal metodo allo statement XML e viceversa; null se manca l'altra metà. */
export function mybatisTarget(link: MyBatisLink, from: MyBatisSide): MyBatisTarget | null {
  if (from === 'java') {
    return link.xmlFile && link.xmlLine ? { file: link.xmlFile, line: link.xmlLine, startColumn: link.xmlStartColumn ?? 1, endColumn: link.xmlEndColumn ?? 1 } : null
  }
  return link.javaFile && link.javaLine ? { file: link.javaFile, line: link.javaLine, startColumn: link.javaStartColumn ?? 1, endColumn: link.javaEndColumn ?? 1 } : null
}

/** Statement XML senza metodo e metodi senza statement: ciò che un mapper rotto mostra a runtime solo come eccezione. */
export function mybatisBrokenLinks(links: readonly MyBatisLink[]): MyBatisLink[] {
  return links.filter((link) => link.state !== 'linked')
}
