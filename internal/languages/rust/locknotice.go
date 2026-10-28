package rust

import (
	"regexp"
	"sync"
)

// buildLockLine riconosce la riga di cargo quando un altro processo detiene il lock della cartella
// di build (`Blocking waiting for file lock on build directory`; "package cache" sulle versioni
// vecchie). Compare all'inizio della Run e sembra un blocco dell'IDE: va riconosciuta e spiegata
// (RS-3.5). Il colore di cargo non conta: si cerca la sottostringa, non la riga intera.
var buildLockLine = regexp.MustCompile(`(?i)blocking waiting for file lock`)

// buildLockExplanation è la spiegazione mostrata una sola volta per esecuzione, subito dopo la
// prima riga di lock. Il `target/` è condiviso da ogni cargo della stessa cartella (RS-9.2 dà a
// rust-analyzer la sua, ma non alle Run): due Run, una Run e `cargo test`, o due unità con la
// stessa target si bloccano a vicenda finché il primo processo non finisce.
const buildLockExplanation = "cargo is waiting for the build lock: another cargo process (a second Run, a test, or another unit sharing this target/ folder) is building first. This run resumes by itself once that process releases the lock — stop it to make room."

// runConsole è la ConsoleLine delle Run e dei test Rust: spiega il lock di cargo e il linker MSVC
// mancante una sola volta per esecuzione e, per il resto, riscrive i percorsi come
// pathFixingConsole. Il parser dei test legge l'output grezzo da OutputTap, quindi la riscrittura
// non tocca l'albero (RS-5).
func runConsole(paths workspacePaths) func(string) (string, bool) {
	inner := pathFixingConsole(paths)
	var mu sync.Mutex
	lockExplained := false
	linkerExplained := false
	return func(line string) (string, bool) {
		linker := missingLinkerLine.MatchString(line)
		if !linker && !buildLockLine.MatchString(line) {
			return inner(line)
		}
		text := line
		if rewritten, handled := inner(line); handled && rewritten != "" {
			text = rewritten
		}
		mu.Lock()
		defer mu.Unlock()
		if linker {
			if linkerExplained {
				return text, true
			}
			linkerExplained = true
			return text + "\n" + missingLinkerExplanation, true
		}
		if lockExplained {
			return text, true
		}
		lockExplained = true
		return text + "\n" + buildLockExplanation, true
	}
}
