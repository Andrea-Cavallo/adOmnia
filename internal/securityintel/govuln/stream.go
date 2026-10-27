// Package govuln legge lo stream JSON di govulncheck e lo riduce al modello condiviso
// di adOmnia Security Intelligence.
//
// È codice puro: nessun I/O, nessuna rete, nessun processo. Lo usano il servizio Code
// Studio (per il pannello vulnerabilità del modulo Go) e l'adapter Go del Security
// Engine (per la Security Center). Una sola interpretazione del protocollo di
// govulncheck: due parser sarebbero due modi di sbagliare.
package govuln

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// Livelli di raggiungibilità di govulncheck: il codice del progetto chiama il simbolo
// vulnerabile, importa solo il package, oppure il modulo è soltanto nel build.
const (
	LevelCalled   = "called"
	LevelImported = "imported"
	LevelRequired = "required"

	// MaxCallPaths limita i percorsi di chiamata conservati per advisory.
	MaxCallPaths = 5
	// MaxFrames limita i frame di un singolo percorso di chiamata.
	MaxFrames = 40
	// AdvisoryURL è l'URL base degli advisory Go.
	AdvisoryURL = "https://pkg.go.dev/vuln/"
	// StdlibModulePath è il nome che govulncheck usa per la standard library.
	StdlibModulePath = "stdlib"
	// ToolchainModuleVer è il nome che govulncheck usa per la toolchain.
	ToolchainModuleVer = "toolchain"
)

// Frame è un passo di un percorso di chiamata: dal codice del progetto al simbolo
// vulnerabile.
type Frame struct {
	Module    string `json:"module,omitempty"`
	Version   string `json:"version,omitempty"`
	Package   string `json:"package,omitempty"`
	Function  string `json:"function,omitempty"`
	Receiver  string `json:"receiver,omitempty"`
	File      string `json:"file,omitempty"`
	Relative  string `json:"relative,omitempty"`
	Line      int    `json:"line,omitzero"`
	Column    int    `json:"column,omitzero"`
	InProject bool   `json:"inProject"`
}

// Finding riassume un advisory per il modulo analizzato.
type Finding struct {
	ID           string   `json:"id"`
	Aliases      []string `json:"aliases,omitempty"`
	Summary      string   `json:"summary,omitempty"`
	Details      string   `json:"details,omitempty"`
	Published    string   `json:"published,omitempty"`
	Modified     string   `json:"modified,omitempty"`
	URL          string   `json:"url"`
	References   []string `json:"references,omitempty"`
	CVSS         []string `json:"cvss,omitempty"`
	Module       string   `json:"module"`
	FoundVersion string   `json:"foundVersion,omitempty"`
	FixedVersion string   `json:"fixedVersion,omitempty"`
	Level        string   `json:"level"`
	Packages     []string `json:"packages,omitempty"`
	Symbols      []string `json:"symbols,omitempty"`
	// CallPaths partono dal codice del progetto (primo elemento) e arrivano al simbolo
	// vulnerabile (ultimo).
	CallPaths [][]Frame `json:"callPaths,omitempty"`
	// DependencyPath è la catena di moduli dal modulo principale a quello vulnerabile.
	DependencyPath []string `json:"dependencyPath,omitempty"`
	// GoModVersion è la versione richiesta nel go.mod del progetto.
	GoModVersion string `json:"goModVersion,omitempty"`
}

// Report è il risultato di una scansione govulncheck.
type Report struct {
	ModulePath      string    `json:"modulePath"`
	ModuleDirectory string    `json:"moduleDirectory"`
	ScannedAt       string    `json:"scannedAt"`
	ScannerVersion  string    `json:"scannerVersion,omitempty"`
	DatabaseUpdated string    `json:"databaseUpdated,omitempty"`
	GoVersion       string    `json:"goVersion,omitempty"`
	Findings        []Finding `json:"findings"`
}

// message è un messaggio dello stream JSON di govulncheck (protocollo v1): un oggetto
// per riga, uno solo dei campi valorizzato.
type message struct {
	Config *struct {
		ScannerVersion string `json:"scanner_version"`
		DB             string `json:"db"`
		DBLastModified string `json:"db_last_modified"`
		GoVersion      string `json:"go_version"`
	} `json:"config"`
	OSV     *osvEntry     `json:"osv"`
	Finding *findingEntry `json:"finding"`
}

type osvEntry struct {
	ID        string   `json:"id"`
	Aliases   []string `json:"aliases"`
	Summary   string   `json:"summary"`
	Details   string   `json:"details"`
	Published string   `json:"published"`
	Modified  string   `json:"modified"`
	Severity  []struct {
		Type  string `json:"type"`
		Score string `json:"score"`
	} `json:"severity"`
	References []struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	} `json:"references"`
	DatabaseSpecific struct {
		URL string `json:"url"`
	} `json:"database_specific"`
}

type findingEntry struct {
	OSV          string       `json:"osv"`
	FixedVersion string       `json:"fixed_version"`
	Trace        []frameEntry `json:"trace"`
}

type frameEntry struct {
	Module   string `json:"module"`
	Version  string `json:"version"`
	Package  string `json:"package"`
	Function string `json:"function"`
	Receiver string `json:"receiver"`
	Position *struct {
		Filename string `json:"filename"`
		Line     int    `json:"line"`
		Column   int    `json:"column"`
	} `json:"position"`
}

// ParseStream legge lo stream JSON di govulncheck e aggrega i finding per advisory.
//
// L'output troncato non è un errore: govulncheck scrive in streaming e un processo
// interrotto ha comunque prodotto risultati utili. Un output che non è affatto JSON è
// invece un errore vero, e va riportato.
func ParseStream(output []byte) (Report, error) {
	report := Report{Findings: []Finding{}}
	advisories := map[string]osvEntry{}
	byID := map[string]*Finding{}
	order := []string{}
	decoder := jsontext.NewDecoder(bytes.NewReader(output))
	parsed := 0
	for {
		var msg message
		err := json.UnmarshalDecode(decoder, &msg)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if parsed == 0 {
				return Report{}, fmt.Errorf("unrecognized govulncheck output: %w", err)
			}
			break // output troncato: si tiene quanto letto
		}
		parsed++
		switch {
		case msg.Config != nil:
			report.ScannerVersion = msg.Config.ScannerVersion
			report.DatabaseUpdated = msg.Config.DBLastModified
			report.GoVersion = msg.Config.GoVersion
		case msg.OSV != nil:
			advisories[msg.OSV.ID] = *msg.OSV
		case msg.Finding != nil:
			finding := byID[msg.Finding.OSV]
			if finding == nil {
				finding = &Finding{ID: msg.Finding.OSV, Level: LevelRequired}
				byID[finding.ID] = finding
				order = append(order, finding.ID)
			}
			mergeFinding(finding, *msg.Finding)
		}
	}
	for _, id := range order {
		finding := byID[id]
		applyAdvisory(finding, advisories[id])
		report.Findings = append(report.Findings, *finding)
	}
	SortFindings(report.Findings)
	return report, nil
}

// mergeFinding unisce una traccia di govulncheck nel finding aggregato.
func mergeFinding(target *Finding, source findingEntry) {
	if source.FixedVersion != "" {
		target.FixedVersion = source.FixedVersion
	}
	if len(source.Trace) == 0 {
		return
	}
	vulnerable := source.Trace[0]
	if target.Module == "" {
		target.Module = vulnerable.Module
		target.FoundVersion = vulnerable.Version
	}
	level := LevelOf(vulnerable.Function, vulnerable.Package)
	if LevelRank(level) > LevelRank(target.Level) {
		target.Level = level
	}
	target.Packages = appendDistinct(target.Packages, vulnerable.Package)
	if vulnerable.Function != "" {
		target.Symbols = appendDistinct(target.Symbols, qualifiedSymbol(vulnerable))
	}
	if level != LevelCalled || len(target.CallPaths) >= MaxCallPaths {
		return
	}
	path := make([]Frame, 0, len(source.Trace))
	// govulncheck ordina la traccia dal simbolo vulnerabile verso il codice del
	// progetto: la si gira perché l'utente legge dal proprio codice al simbolo.
	for index := len(source.Trace) - 1; index >= 0 && len(path) < MaxFrames; index-- {
		path = append(path, frameOf(source.Trace[index]))
	}
	if !containsCallPath(target.CallPaths, path) {
		target.CallPaths = append(target.CallPaths, path)
	}
}

// LevelOf deriva il livello di raggiungibilità da ciò che la traccia contiene.
func LevelOf(function, pkg string) string {
	switch {
	case function != "":
		return LevelCalled
	case pkg != "":
		return LevelImported
	default:
		return LevelRequired
	}
}

// LevelRank ordina i livelli: più alto, più l'evidenza è forte.
func LevelRank(level string) int {
	switch level {
	case LevelCalled:
		return 3
	case LevelImported:
		return 2
	default:
		return 1
	}
}

// qualifiedSymbol è il nome completo di un simbolo, con il receiver se c'è.
func qualifiedSymbol(frame frameEntry) string {
	if frame.Receiver != "" {
		return strings.TrimPrefix(frame.Receiver, "*") + "." + frame.Function
	}
	return frame.Function
}

// frameOf traduce un frame di govulncheck nel modello condiviso.
func frameOf(frame frameEntry) Frame {
	result := Frame{Module: frame.Module, Version: frame.Version, Package: frame.Package, Function: frame.Function, Receiver: frame.Receiver}
	if frame.Position != nil {
		// govulncheck scrive il file relativo alla radice del suo modulo: si risolve
		// dopo, con le radici dei sorgenti del progetto.
		result.File = filepath.ToSlash(frame.Position.Filename)
		result.Line = frame.Position.Line
		result.Column = frame.Position.Column
	}
	return result
}

// containsCallPath evita di conservare due volte lo stesso percorso di chiamata.
func containsCallPath(paths [][]Frame, candidate []Frame) bool {
	for _, path := range paths {
		if len(path) != len(candidate) {
			continue
		}
		same := true
		for index := range path {
			if path[index].Function != candidate[index].Function || path[index].Package != candidate[index].Package || path[index].Line != candidate[index].Line {
				same = false
				break
			}
		}
		if same {
			return true
		}
	}
	return false
}

// applyAdvisory porta sul finding i dati dell'advisory OSV che govulncheck ha
// consultato: testo, severità, riferimenti e URL.
func applyAdvisory(finding *Finding, advisory osvEntry) {
	finding.Aliases = advisory.Aliases
	finding.Summary = advisory.Summary
	finding.Details = advisory.Details
	finding.Published = advisory.Published
	finding.Modified = advisory.Modified
	finding.URL = AdvisoryURL + finding.ID
	if advisory.DatabaseSpecific.URL != "" {
		finding.URL = advisory.DatabaseSpecific.URL
	}
	for _, severity := range advisory.Severity {
		if severity.Score != "" {
			finding.CVSS = append(finding.CVSS, severity.Score)
		}
	}
	for _, reference := range advisory.References {
		if reference.URL != "" {
			finding.References = appendDistinct(finding.References, reference.URL)
		}
	}
}

// SortFindings mette prima ciò che il codice chiama davvero, poi per modulo e ID.
func SortFindings(findings []Finding) {
	sort.SliceStable(findings, func(left, right int) bool {
		a, b := findings[left], findings[right]
		if LevelRank(a.Level) != LevelRank(b.Level) {
			return LevelRank(a.Level) > LevelRank(b.Level)
		}
		if a.Module != b.Module {
			return a.Module < b.Module
		}
		return a.ID < b.ID
	})
}

// appendDistinct aggiunge value se non vuoto e non già presente.
func appendDistinct(values []string, value string) []string {
	if value == "" {
		return values
	}
	if slices.Contains(values, value) {
		return values
	}
	return append(values, value)
}
