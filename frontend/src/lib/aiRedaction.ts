// Redazione dei segreti nel testo inviato a un provider AI. È reversibile: ogni segreto diventa un
// segnaposto e restore() lo rimette nella risposta, così una correzione proposta non lo cancella.

// Solo pattern ad alta precisione: nel codice un falso positivo cambierebbe il contesto per l'AI.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]*/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{36,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9\-_]{20,}\b/g,
  /\bxox[bprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z\-_]{35}\b/g,
]

// Password nelle connection string: si sostituisce solo la password, l'URL resta leggibile.
const CONNECTION_PASSWORD = /((?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^:@\s/"'`]+:)([^@\s"'`]+)(@)/gi

// Stringhe assegnate a nomi sensibili: password := "x", APIKey: "x", secret = `x`.
const SENSITIVE_ASSIGNMENT = /(\b[A-Za-z_]*(?:password|passwd|secret|token|apikey|api_key|accesskey|access_key|privatekey|private_key|credential)[A-Za-z_0-9]*\b\s*(?::=|=|:)\s*)(["'`])([^"'`\n]{4,})\2/gi

const PLACEHOLDER = /ADOMNIA_REDACTED_\d+/g

export interface AIRedactor {
  /** Sostituisce i segreti con segnaposto; lo stesso segreto ha sempre lo stesso segnaposto. */
  redact: (text: string) => string
  /** Rimette i segreti originali al posto dei segnaposto, anche nella risposta dell'AI. */
  restore: (text: string) => string
  /** Numero di segreti distinti nascosti finora. */
  count: () => number
}

/** Un redattore per richiesta: più file condividono i segnaposto, la risposta si ripristina con restore. */
export function createAIRedactor(): AIRedactor {
  const secrets: string[] = []
  const hide = (secret: string): string => {
    let index = secrets.indexOf(secret)
    if (index < 0) index = secrets.push(secret) - 1
    return `ADOMNIA_REDACTED_${index + 1}`
  }
  return {
    redact: (input) => {
      let text = input.replace(SENSITIVE_ASSIGNMENT, (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${hide(value)}${quote}`)
      text = text.replace(CONNECTION_PASSWORD, (_match, prefix: string, password: string, at: string) => `${prefix}${hide(password)}${at}`)
      for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (secret) => (/^ADOMNIA_REDACTED_\d+$/.test(secret) ? secret : hide(secret)))
      return text
    },
    restore: (output) => output.replace(PLACEHOLDER, (placeholder) => secrets[Number(placeholder.slice('ADOMNIA_REDACTED_'.length)) - 1] ?? placeholder),
    count: () => secrets.length,
  }
}
