package securityintel

import "context"

// Target è un manifest da analizzare: la unità minima su cui un adapter lavora.
// Un monorepo con un pom.xml e due moduli Go produce tre Target.
type Target struct {
	Ecosystem Ecosystem `json:"ecosystem"`
	// Root è la cartella dell'unità, assoluta.
	Root string `json:"root"`
	// Manifest è il file assoluto che definisce l'unità (pom.xml, go.mod, go.work).
	Manifest string `json:"manifest"`
	// Name è il nome logico (artifactId, module path). Può essere vuoto.
	Name string `json:"name,omitempty"`
}

// ResolveOptions guida la risoluzione delle dipendenze di un adapter.
type ResolveOptions struct {
	// Offline vieta il ricorso a repository remoti o a qualsiasi rete. Serve la
	// "Privacy by Design": l'analisi offline lavora solo su ciò che è già in locale.
	Offline bool
	// IncludePluginDependencies include le dipendenze dei plugin di build (Maven).
	IncludePluginDependencies bool
	// AllowProcesses autorizza l'avvio di processi esterni (mvn, go) per la
	// risoluzione. Falso di default: l'analisi statica non avvia nulla, e chi apre il
	// progetto decide esplicitamente prima di autorizzare uno strumento esterno.
	AllowProcesses bool
	// IncludeIndirectSpecific considera anche le dipendenze dichiarate "optional".
	IncludeOptional bool
	// Environment è l'ambiente dei processi esterni (mvn, go). Vuoto: ambiente corrente.
	Environment []string
	// BuildTags, GOOS e GOARCH selezionano il contesto di build da analizzare (Go).
	BuildTags string
	GOOS      string
	GOARCH    string
	// MaxComponents limita la risoluzione per manifest, contro pom o grafi patologici.
	MaxComponents int
}

// DefaultResolveOptions è il comportamento di default di una scansione.
func DefaultResolveOptions() ResolveOptions {
	return ResolveOptions{MaxComponents: 5000}
}

// Resolution è il grafo delle dipendenze effettivamente risolte di un manifest.
//
// "Effettivamente risolte" è la parola chiave: non le dichiarazioni del manifest, ma
// ciò che il build risolverebbe davvero, con versioni, scope e origine. Per Maven
// significa il dependency tree effettivo (parent, BOM, dependencyManagement); per Go
// significa la Minimal Version Selection applicata, dopo replace e go.work.
type Resolution struct {
	Components []Component `json:"components"`
	// Warnings raccolgono ciò che la risoluzione non ha potuto stabilire con certezza:
	// un BOM irraggiungibile, una proprietà non risolta, un replace non verificabile.
	Warnings []string `json:"warnings,omitempty"`
	// EffectivePOM è l'XML dell'effective POM quando l'adapter lo calcola (Maven).
	EffectivePOM string `json:"effectivePom,omitempty"`
}

// EcosystemAdapter risolve le dipendenze del proprio ecosistema.
//
// Il core non conosce i dettagli di un ecosistema: questo è il confine che permette
// di aggiungere package.json, Cargo.toml o Gradle senza duplicare la logica CVE.
// L'unico contratto è: dati un manifest e delle opzioni, restituisci i componenti
// effettivamente risolti.
type EcosystemAdapter interface {
	// Ecosystem identifica l'ecosistema dell'adapter.
	Ecosystem() Ecosystem
	// Discover trova i manifest riconosciuti sotto root, in modo deterministico.
	// Non deve avviare processi né usare la rete.
	Discover(ctx context.Context, root string) ([]Target, error)
	// Resolve risolve il grafo delle dipendenze effettive del manifest.
	Resolve(ctx context.Context, target Target, options ResolveOptions) (Resolution, error)
}

// ReachabilityAnalyzer è una capability opzionale: un adapter che sa stabilire se il
// codice vulnerabile è effettivamente raggiungibile. Viene scoperta per type
// assertion, come le capability dell'IDE Platform: un adapter senza questa capacità
// lascia la raggiungibilità a "unknown" e il core non inventa risultati.
type ReachabilityAnalyzer interface {
	// AnalyzeReachability arricchisce i finding con l'evidenza di raggiungibilità.
	// Restituisce un Evidence per ogni finding, nello stesso ordine.
	AnalyzeReachability(ctx context.Context, target Target, findings []Finding, options ResolveOptions) ([]Evidence, error)
}

// RemediationPlanner è una capability opzionale: un adapter che sa proporre la modifica
// concreta al manifest, con ciò che risolve e ciò che introduce.
type RemediationPlanner interface {
	// PlanRemediation completa Remediation per ogni finding.
	PlanRemediation(ctx context.Context, target Target, findings []Finding, options ResolveOptions) ([]Remediation, error)
}

// VerifyStep descrive un passo di verifica di un piano di remediation: ciò che il
// motore esegue dopo aver modificato un manifest, prima di rendere la modifica
// definitiva.
type VerifyStep struct {
	// ID è l'identificativo stabile del passo ("resolve", "build", "test", "rescan").
	ID string `json:"id"`
	// Label è il nome mostrato all'utente.
	Label string `json:"label"`
	// Command è il comando come appare all'utente, già pronto da rivedere.
	Command string `json:"command,omitempty"`
	// Program e Args sono la riga di comando effettiva, quando il passo avvia un
	// processo. Program vuoto significa che lo strumento non è installato.
	Program string   `json:"program,omitempty"`
	Args    []string `json:"args,omitempty"`
	// Dir è la cartella di lavoro del processo.
	Dir string `json:"dir,omitempty"`
	// Env aggiunge variabili all'ambiente del processo (es. GOPROXY=off offline).
	Env []string `json:"env,omitempty"`
	// RequiresProcess dice che il passo avvia un processo esterno: senza
	// autorizzazione esplicita dell'utente il motore non lo esegue mai.
	RequiresProcess bool `json:"requiresProcess"`
}

// UpgradeEditor è una capability opzionale: un adapter che sa generare la modifica
// testuale del proprio manifest per un aggiornamento e descrivere i passi di
// verifica che la validano. È il confine che rende possibile la remediation guidata
// senza versare dettagli di un ecosistema nel core.
type UpgradeEditor interface {
	// UpgradeManifest ritorna il testo del manifest con il componente aggiornato a
	// targetVersion. Deve essere una trasformazione pura del testo: nessun processo,
	// nessuna rete, nessuna scrittura su disco. Un errore significa che la modifica
	// non è applicabile in automatico e va proposta come bloccata, invece di un
	// comando che fallisce.
	UpgradeManifest(manifestText string, component Component, targetVersion string) (string, error)
	// VerifySteps descrive i passi di verifica dell'adapter da eseguire dopo la
	// modifica (compilazione, test). Il motore aggiunge i passi generici.
	VerifySteps(target Target, component Component, targetVersion string, options ResolveOptions) []VerifyStep
}

// ComponentGraphBuilder è una capability opzionale: un adapter che sa ricostruire la
// catena di dipendenze che porta a un componente vulnerabile.
type ComponentGraphBuilder interface {
	// DependencyPath ritorna la catena dal manifest radice al componente.
	DependencyPath(ctx context.Context, target Target, component Component, options ResolveOptions) []string
}
