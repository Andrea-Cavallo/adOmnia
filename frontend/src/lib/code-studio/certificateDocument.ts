/** Estensioni dei file PEM di testo: certificati, catene e chiavi private. */
const CERTIFICATE_EXTENSION = /\.(pem|crt|cer|cert|key)$/i
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----/

/** Giorni sotto i quali un certificato valido è segnalato come in scadenza. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30

/** Un .pem/.crt/.cer/.key di testo si apre già decodificato; un .cer binario (DER) resta al resto dell'IDE. */
export function isCertificateDocument(path: string, text: string): boolean {
  return CERTIFICATE_EXTENSION.test(path) && PEM_BLOCK.test(text)
}

export type CertificateValidity = 'expired' | 'not-yet-valid' | 'expiring' | 'valid'

export function certificateValidity(info: { isExpired: boolean; isNotYetValid: boolean; daysRemaining: number }): CertificateValidity {
  if (info.isExpired) return 'expired'
  if (info.isNotYetValid) return 'not-yet-valid'
  return info.daysRemaining <= CERTIFICATE_EXPIRY_WARNING_DAYS ? 'expiring' : 'valid'
}

/** Nome leggibile di soggetto o emittente: CN, poi O, OU, L, ST, C come in un browser. */
export function distinguishedName(rdn: { cn?: string; o?: string; ou?: string; l?: string; st?: string; c?: string }): string {
  return [rdn.cn && `CN=${rdn.cn}`, rdn.o && `O=${rdn.o}`, rdn.ou && `OU=${rdn.ou}`, rdn.l && `L=${rdn.l}`, rdn.st && `ST=${rdn.st}`, rdn.c && `C=${rdn.c}`]
    .filter((part): part is string => Boolean(part))
    .join(', ')
}
