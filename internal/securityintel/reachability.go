package securityintel

// Reachability è l'evidenza che il codice vulnerabile possa essere raggiunto dal
// progetto. Non è un giudizio di sicurezza:
//
//   - "called" e "potentiallyReachable" sono evidenze positive e alzano la priorità;
//   - "notReachable" è un risultato dell'analisi, non una garanzia: riflessione,
//     class loading dinamico, framework e OSGi possono rendere raggiungibile ciò che
//     l'analisi statica non ha visto;
//   - "unknown" significa che l'analisi non è stata fatta o non è conclusiva. Non va
//     mai letto come "sicuro".
type Reachability string

const (
	// ReachabilityCalled: il codice del progetto chiama il simbolo vulnerabile.
	ReachabilityCalled Reachability = "called"
	// ReachabilityImported: il package vulnerabile è importato, nessun simbolo chiamato.
	ReachabilityImported Reachability = "imported"
	// ReachabilityRequired: il modulo è soltanto nel grafo di build.
	ReachabilityRequired Reachability = "required"
	// ReachabilityPotentiallyReachable: analisi statica (es. bytecode Java) ha trovato
	// riferimenti a classi o metodi vulnerabili senza poter confermare la chiamata.
	ReachabilityPotentiallyReachable Reachability = "potentiallyReachable"
	// ReachabilityNotReachable: l'analisi ha escluso percorsi di chiamata verso il
	// codice vulnerabile. Non è una garanzia di assenza di rischio.
	ReachabilityNotReachable Reachability = "notReachable"
	// ReachabilityUnknown: nessuna analisi di raggiungibilità eseguita o inconcludente.
	ReachabilityUnknown Reachability = "unknown"
)

// ReachabilityLevels è l'ordine con cui i livelli compaiono nei report e nelle
// legende della UI.
var ReachabilityLevels = []Reachability{
	ReachabilityCalled,
	ReachabilityPotentiallyReachable,
	ReachabilityImported,
	ReachabilityRequired,
	ReachabilityNotReachable,
	ReachabilityUnknown,
}

// reachabilityRank ordina per evidenza: più alto, più l'evidenza è forte.
func reachabilityRank(level Reachability) int {
	switch level {
	case ReachabilityCalled:
		return 6
	case ReachabilityPotentiallyReachable:
		return 5
	case ReachabilityImported:
		return 4
	case ReachabilityRequired:
		return 3
	case ReachabilityUnknown:
		return 2
	case ReachabilityNotReachable:
		return 1
	default:
		return 0
	}
}

// ReachabilityLabel è la dicitura mostrata in UI per un livello.
func (r Reachability) Label() string {
	switch r {
	case ReachabilityCalled:
		return "Called"
	case ReachabilityImported:
		return "Imported"
	case ReachabilityRequired:
		return "Required only"
	case ReachabilityPotentiallyReachable:
		return "Potentially reachable"
	case ReachabilityNotReachable:
		return "Not reachable"
	default:
		return "Not analyzed"
	}
}

// EvidenceMethodNone e EvidenceMethodBytecodeReference sono i metodi di analisi che
// il motore interpreta in modo specifico. "none" significa che l'analisi non è stata
// fatta; "bytecode-reference" che è stata fatta sulle classi compilate ma non ha
// trovato abbastanza per un livello: nessuno dei due prova che il modulo sia soltanto
// nel grafo di build, e non vanno letti come "required".
const (
	EvidenceMethodNone              = "none"
	EvidenceMethodBytecodeReference = "bytecode-reference"
)

// Evidence describe come è stata stabilita la raggiungibilità: chi l'ha analizzata e
// con quale livello di dettaglio. Serve a distinguere una conferma da una supposizione.
type Evidence struct {
	// Method è lo strumento o la tecnica: "govulncheck-symbol", "govulncheck-imports",
	// "bytecode-reference", "none".
	Method string `json:"method,omitempty"`
	// Confirmed dice se l'evidenza è una conferma (simbolo chiamato) o un'ipotesi.
	Confirmed bool `json:"confirmed"`
	// Note spiega il limite dell'analisi, in linguaggio comprensibile.
	Note string `json:"note,omitempty"`
	// CallPaths parte dal codice del progetto (primo elemento) e arriva al simbolo
	// vulnerabile (ultimo). L'assenza di percorsi non è garanzia di sicurezza.
	CallPaths [][]CallFrame `json:"callPaths,omitempty"`
	// Symbols sono i simboli vulnerabili coinvolti.
	Symbols []string `json:"symbols,omitempty"`
	// Packages sono i package vulnerabili coinvolti.
	Packages []string `json:"packages,omitempty"`
}

// ReachabilityNote spiega in modo onesto cosa significa un livello per l'utente.
// La UI deve mostrarla: un livello senza la sua interpretazione induce a fidarsi.
func ReachabilityNote(level Reachability) string {
	switch level {
	case ReachabilityCalled:
		return "Confirmed: the project code calls the vulnerable symbol. The vulnerability is on a real code path."
	case ReachabilityPotentiallyReachable:
		return "Potentially reachable: the analysis found references to the vulnerable code but could not confirm a call path. Reflection, dynamic class loading and frameworks can make it reachable anyway."
	case ReachabilityImported:
		return "The vulnerable package is imported but no vulnerable symbol was found in use. An update or a code change can make it reachable."
	case ReachabilityRequired:
		return "The module is only in the build graph. No import of the vulnerable package was found in the analyzed code."
	case ReachabilityNotReachable:
		return "No call path to the vulnerable code was found. This is an analysis result, not a guarantee: reflection, dynamic loading, dependency injection and native code are outside what static analysis can see."
	default:
		return "Reachability was not analyzed. Treat this finding as if the vulnerable code were reachable."
	}
}

// NormalizeReachability riempie il livello e la nota quando mancano, così nessun
// finding arriva in UI senza la propria interpretazione.
func (e *Evidence) NormalizeReachability() Reachability {
	level := ReachabilityUnknown
	for _, path := range e.CallPaths {
		if len(path) > 0 {
			level = ReachabilityCalled
			break
		}
	}
	if level == ReachabilityUnknown && len(e.Symbols) > 0 {
		level = ReachabilityPotentiallyReachable
	}
	return level
}
