// Package securityintel è il motore di adOmnia Security Intelligence: un solo engine
// estendibile per la sicurezza delle dipendenze, con adapter per ogni ecosistema.
//
// Il core è indipendente dall'ecosistema. Conosce Component, Advisory, Finding e il
// risk model; non sa nulla di Maven o di Go. Gli adapter (securityintel/maven,
// securityintel/gomod) risolvono le dipendenze di un manifest e la raggiungibilità.
// Aggiungere package.json, Cargo.toml o Gradle significa un nuovo adapter, non una
// seconda logica CVE.
//
// Privacy by design: il motore non invia mai sorgenti a servizi esterni. Interroga
// solo indici pubblici di advisory per *coordinate* (nome + versione), rispetta la
// politica di rete di adOmnia e lavora offline quando il database locale è presente.
package securityintel

// Ecosystem identifica il gestore di dipendenze che ha prodotto un componente.
type Ecosystem string

const (
	// EcosystemMaven è l'ecosistema Maven (coordinate group:artifact).
	EcosystemMaven Ecosystem = "Maven"
	// EcosystemGo è l'ecosistema Go (path del modulo).
	EcosystemGo Ecosystem = "Go"
)

// Ecosystems è l'ordine stabile con cui gli ecosistemi compaiono nei report.
var Ecosystems = []Ecosystem{EcosystemMaven, EcosystemGo}

// Origin dice come è arrivata una dipendenza nel grafo: cambia il rischio percepito
// e la difficoltà della correzione.
type Origin string

const (
	// OriginDeclared è scritta direttamente nel manifest dell'unità analizzata.
	OriginDeclared Origin = "declared"
	// OriginInherited arriva da un parent POM o da un BOM importato.
	OriginInherited Origin = "inherited"
	// OriginManaged ha la versione imposta da un BOM o da dependencyManagement.
	OriginManaged Origin = "managed"
	// OriginTransitive è trascinata da un'altra dipendenza.
	OriginTransitive Origin = "transitive"
	// OriginPlugin è una dipendenza di un plugin di build (solo Maven).
	OriginPlugin Origin = "plugin"
	// OriginToolchain è la standard library o la toolchain (Go).
	OriginToolchain Origin = "toolchain"
)

// Scope è l'esposizione di una dipendenza nel ciclo di vita del build. È uno dei
// segnali del risk model: una libreria di test non espone un servizio in produzione.
type Scope string

const (
	ScopeCompile   Scope = "compile"
	ScopeRuntime   Scope = "runtime"
	ScopeProvided  Scope = "provided"
	ScopeTest      Scope = "test"
	ScopeSystem    Scope = "system"
	ScopeImport    Scope = "import"
	ScopeBuild     Scope = "build"
	ScopeToolchain Scope = "toolchain"
)

// Exposure è l'esposizione effettiva del componente nel contesto applicativo,
// normalizzata su quattro livelli indipendenti dall'ecosistema.
type Exposure string

const (
	// ExposureRuntime finisce nella distribuzione ed è eseguito in produzione.
	ExposureRuntime Exposure = "runtime"
	// ExposureBuild serve solo per costruire (compilazione, codegen, packaging).
	ExposureBuild Exposure = "build"
	// ExposureTest serve solo nei test.
	ExposureTest Exposure = "test"
	// ExposureUnknown: il contesto non è determinabile con certezza.
	ExposureUnknown Exposure = "unknown"
)

// ExposureOf traduce uno scope ecosistema-specifico nell'esposizione normalizzata.
func ExposureOf(scope Scope, origin Origin) Exposure {
	if origin == OriginPlugin {
		return ExposureBuild
	}
	switch scope {
	case ScopeRuntime, ScopeCompile, ScopeSystem:
		return ExposureRuntime
	case ScopeProvided:
		return ExposureBuild
	case ScopeTest:
		return ExposureTest
	case ScopeBuild, ScopeToolchain:
		return ExposureBuild
	default:
		return ExposureUnknown
	}
}

// Component è una dipendenza risolta nel grafo, diretta o transitive.
type Component struct {
	Ecosystem Ecosystem `json:"ecosystem"`
	// Name è il coordinate dell'ecosistema: "group:artifact" per Maven, il path del
	// modulo per Go. È il nome con cui l'OSV identifica il pacchetto.
	Name string `json:"name"`
	// Version è la versione effettivamente risolta, non quella dichiarata.
	Version  string   `json:"version"`
	Scope    Scope    `json:"scope,omitempty"`
	Origin   Origin   `json:"origin"`
	Exposure Exposure `json:"exposure"`
	// Manifest è il file assoluto del manifest che ha portato il componente nel grafo.
	Manifest string `json:"manifest,omitempty"`
	// Module è il path del modulo Go (uguale a Name per l'ecosistema Go); serve per
	// tenere separato il coordinate dal percorso di moduli in go.work multi-modulo.
	Module string `json:"module,omitempty"`
	// DependencyPath è la catena di dipendenze dal manifest radice al componente.
	DependencyPath []string `json:"dependencyPath,omitempty"`
	// Replace è il valore di una direttiva replace/go.work che sostituisce la versione
	// risolta (Go): la versione del grafo non è quella che un utente si aspetterebbe.
	Replace string `json:"replace,omitempty"`
	// Direct indica una dipendenza dichiarata nel manifest della radice.
	Direct bool `json:"direct"`
}

// Key è l'identità stabile del componente, usata per deduplicare findings e SBOM.
func (c Component) Key() string {
	return string(c.Ecosystem) + ":" + c.Name + "@" + c.Version
}

// CallFrame è un passo di un percorso di chiamata: dal codice del progetto al simbolo
// vulnerabile. Il percorso è una evidenza di raggiungibilità, non una garanzia:
// l'assenza di percorsi rilevati non dimostra che il codice sia sicuro.
type CallFrame struct {
	Module    string `json:"module,omitempty"`
	Version   string `json:"version,omitempty"`
	Package   string `json:"package,omitempty"`
	Function  string `json:"function,omitempty"`
	Receiver  string `json:"receiver,omitempty"`
	File      string `json:"file,omitempty"`
	Relative  string `json:"relative,omitempty"`
	Line      int    `json:"line,omitempty"`
	Column    int    `json:"column,omitempty"`
	InProject bool   `json:"inProject"`
}

// VersionRange è un intervallo di versioni affette, come lo descrive un advisory.
// Gli advisory esprimono più intervalli separati: la stessa vulnerabilità può
// colpire la 1.x e la 2.x e essere corretta solo in certi rami.
type VersionRange struct {
	// Introduced è la prima versione affetta. "0" significa "dalla prima versione".
	Introduced string `json:"introduced,omitempty"`
	// Fixed è la versione che chiude l'intervallo. Vuoto con LastAffected valorizzato
	// significa che l'ultima versione affetta è nota ma non c'è una correzione.
	Fixed string `json:"fixed,omitempty"`
	// LastAffected è l'ultima versione affetta nota.
	LastAffected string `json:"lastAffected,omitempty"`
}

// Includes dice se una versione cade nell'intervallo.
func (r VersionRange) Includes(version string) bool {
	if r.Introduced != "" && r.Introduced != "0" {
		if compareVersions(version, r.Introduced) < 0 {
			return false
		}
	}
	if r.Fixed != "" {
		return compareVersions(version, r.Fixed) < 0
	}
	if r.LastAffected != "" {
		return compareVersions(version, r.LastAffected) <= 0
	}
	// Senza limite superiore: tutto ciò che è stato introdotto è affetto.
	return true
}

// String è la rappresentazione leggibile dell'intervallo.
func (r VersionRange) String() string {
	switch {
	case r.Fixed != "" && r.Introduced != "":
		return ">= " + r.Introduced + ", < " + r.Fixed
	case r.Fixed != "":
		return "< " + r.Fixed
	case r.LastAffected != "" && r.Introduced != "":
		return ">= " + r.Introduced + ", <= " + r.LastAffected
	case r.LastAffected != "":
		return "<= " + r.LastAffected
	case r.Introduced != "":
		return ">= " + r.Introduced
	default:
		return "all versions"
	}
}

// Advisory è una vulnerabilità normalizzata da una o più fonti (OSV, GHSA, Go
// Vulnerability Database, NVD). Più fonti descrivono la stessa vulnerabilità: il
// motore la deduplica sugli alias.
type Advisory struct {
	// ID è l'identificativo primario: GO-2025-…, GHSA-…, CVE-…, PYSEC-….
	ID string `json:"id"`
	// Aliases sono gli altri identificativi della stessa vulnerabilità (CVE, GHSA…).
	Aliases    []string `json:"aliases,omitempty"`
	Summary    string   `json:"summary,omitempty"`
	Details    string   `json:"details,omitempty"`
	Published  string   `json:"published,omitempty"`
	Modified   string   `json:"modified,omitempty"`
	References []string `json:"references,omitempty"`
	Severity   Severity `json:"severity"`
	// VulnerableRanges sono le versioni affette come le descrive l'advisory, in forma
	// leggibile. Il confronto operativo usa Ranges.
	VulnerableRanges []string `json:"vulnerableRanges,omitempty"`
	// Ranges sono gli intervalli di versioni affette, in forma valutabile.
	Ranges []VersionRange `json:"ranges,omitempty"`
	// FixedVersions sono le versioni che chiudono la vulnerabilità.
	FixedVersions []string `json:"fixedVersions,omitempty"`
	// Withdrawn è la data di ritiro dell'advisory: non è più considerato valido.
	Withdrawn string `json:"withdrawn,omitempty"`
	// Sources elenca le fonti che hanno confermato l'advisory.
	Sources []string `json:"sources,omitempty"`
}

// CVE ritorna il primo identificativo CVE fra ID e alias, vuoto se non ce n'è.
func (a Advisory) CVE() string {
	if isCVE(a.ID) {
		return a.ID
	}
	for _, alias := range a.Aliases {
		if isCVE(alias) {
			return alias
		}
	}
	return ""
}

// isCVE dice se un identificativo è un CVE.
func isCVE(id string) bool {
	return len(id) > 4 && (id[:4] == "CVE-" || id[:4] == "cve-")
}
