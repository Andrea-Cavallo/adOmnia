/**
 * Emblema dei file manifest: l'anello rosso/nero con la M e la F del logo del progetto.
 *
 * Il nero del logo diventa `currentColor` così l'emblema si legge sia sul tema scuro sia su quello
 * chiaro: un nero fisso scomparirebbe sullo sfondo dell'albero. Il rosso è quello del marchio.
 */
export function ManifestFileIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Manifest"
      className="shrink-0 text-text-1"
    >
      {/* Anello: metà rosso in alto a sinistra, metà scura in basso a destra. */}
      <path d="M45.5 8.6A27 27 0 0 0 18.5 55.4" fill="none" stroke="#e01b1b" strokeWidth={7} />
      <path d="M18.5 55.4A27 27 0 0 1 45.5 8.6" fill="none" stroke="currentColor" strokeWidth={7} />
      {/* M rossa con l'incavo centrale. */}
      <path d="M12 46V18h8l7 13 7-13h8v28h-7V31l-8 14-8-14v15z" fill="#e01b1b" />
      {/* F scura: asta, sbarra superiore e sbarra centrale. */}
      <path d="M37 18h7v28h-7z" fill="currentColor" />
      <path d="M37 18h18v6H37z" fill="currentColor" />
      <path d="M37 28h12v6H37z" fill="currentColor" />
      {/* Quadrato rosso in basso a destra, come nel marchio. */}
      <path d="M45 39h8v8h-8z" fill="#e01b1b" />
    </svg>
  )
}
