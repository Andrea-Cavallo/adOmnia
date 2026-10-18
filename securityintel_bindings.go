package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	"adomnia/internal/securityintel"
	"adomnia/internal/securityintel/gomod"
	"adomnia/internal/securityintel/maven"
)

// SecurityIntel espone adOmnia Security Intelligence al frontend: scansione delle
// dipendenze del workspace, esportazione del report e gestione delle soppressioni.
//
// Il binding resta sottile: costruisce il motore, traduce le opzioni da e verso JSON e
// non contiene logica di sicurezza. Tutto il ragionamento vive in internal/securityintel.
//
// I metodi di remediation (PreviewUpgrade, PlanUpgrade, RunUpgradeStep, FinishUpgrade)
// seguono la regola del repository per l'avvio di processi: nessun passo che avvia un
// processo esterno viene eseguito senza l'autorizzazione esplicita dell'utente
// (ResolveOptions.AllowProcesses, di default falso). Il core rifiuta ogni passo del
// genere e lo riporta come "skipped", mai eseguito silenziosamente.
type SecurityIntel struct {
	// plans tiene i piani di remediation aperti: la modifica a un manifest resta
	// provvisoria e ripristinabile finché l'utente non la conferma.
	plans *securityintel.PlanStore
}

// NewSecurityIntel crea il servizio.
func NewSecurityIntel() *SecurityIntel {
	return &SecurityIntel{plans: securityintel.NewPlanStore()}
}

// ScanOptionsJSON descrive le opzioni di scansione che il frontend invia.
type ScanOptionsJSON struct {
	// Ecosystems filtra gli ecosistemi ("Maven", "Go"). Vuoto: tutti.
	Ecosystems []string `json:"ecosystems,omitempty"`
	// Offline vieta le richieste ai database di advisory: si usa la cache locale.
	Offline bool `json:"offline,omitempty"`
	// AllowProcesses autorizza mvn e govulncheck. Il progetto deve essere autorizzato.
	AllowProcesses bool `json:"allowProcesses,omitempty"`
	// IncludePluginDependencies include le dipendenze dei plugin di build Maven.
	IncludePluginDependencies bool `json:"includePluginDependencies,omitempty"`
	// IncludeOptional considera anche le dipendenze opzionali Maven.
	IncludeOptional bool `json:"includeOptional,omitempty"`
	// SourceEndpoints sostituisce gli endpoint delle fonti con specchi aziendali.
	SourceEndpoints map[string]string `json:"sourceEndpoints,omitempty"`
}

// ScanWorkspace esegue la scansione delle dipendenze del workspace e restituisce il
// report in JSON. optionsJSON è un ScanOptionsJSON; vuoto significa opzioni di default.
//
// La scansione è on-demand e locale: interroga solo indici pubblici di advisory per
// coordinate di pacchetto, mai sorgenti o nomi di file del progetto.
func (s *SecurityIntel) ScanWorkspace(root string, optionsJSON string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	options := ScanOptionsJSON{}
	if optionsJSON != "" {
		if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
			return "", fmt.Errorf("invalid scan options: %w", err)
		}
	}
	settings, err := securityintel.LoadWorkspaceSettings(root)
	if err != nil {
		return "", err
	}

	engine, _ := buildSecurityEngine(options, settings)
	request := securityintel.ScanRequest{
		Root:         root,
		Options:      resolveOptionsFrom(options, settings),
		Ecosystems:   selectedEcosystems(options.Ecosystems, settings.Ecosystems),
		Suppressions: settings.Suppressions,
	}

	ctx, cancel := context.WithTimeout(context.Background(), securityScanTimeout)
	defer cancel()
	report, err := engine.Scan(ctx, request)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(report)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// securityScanTimeout è il tempo massimo di una scansione completa.
const securityScanTimeout = 10 * time.Minute

// ExportReport serializza un report già ottenuto nel formato richiesto.
// I formati sono json, sarif, html, cyclonedx e spdx.
func (s *SecurityIntel) ExportReport(reportJSON string, format string) (string, error) {
	report := securityintel.ScanReport{}
	if err := json.Unmarshal([]byte(reportJSON), &report); err != nil {
		return "", fmt.Errorf("invalid report: %w", err)
	}
	payload, err := securityintel.Export(report, format)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// ExportFormats elenca i formati di esportazione disponibili, con l'estensione.
func (s *SecurityIntel) ExportFormats() (string, error) {
	type entry struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Ext  string `json:"extension"`
	}
	names := map[string]string{
		securityintel.FormatJSON:    "JSON",
		securityintel.FormatSARIF:   "SARIF 2.1.0",
		securityintel.FormatHTML:    "HTML report",
		securityintel.FormatCyclone: "CycloneDX SBOM",
		securityintel.FormatSPDX:    "SPDX SBOM",
	}
	entries := []entry{}
	for _, format := range securityintel.SupportedFormats {
		entries = append(entries, entry{ID: format, Name: names[format], Ext: securityintel.FileExtension(format)})
	}
	payload, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// SecuritySettings legge la configurazione di sicurezza del progetto.
func (s *SecurityIntel) SecuritySettings(root string) (string, error) {
	settings, err := securityintel.LoadWorkspaceSettings(root)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// PutSuppression aggiunge o aggiorna una soppressione e salva la configurazione.
// Il JSON è un securityintel.Suppression. Senza motivazione viene rifiutata.
func (s *SecurityIntel) PutSuppression(root string, suppressionJSON string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	suppression := securityintel.Suppression{}
	if err := json.Unmarshal([]byte(suppressionJSON), &suppression); err != nil {
		return "", fmt.Errorf("invalid suppression: %w", err)
	}
	if suppression.CreatedAt == "" {
		suppression.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	settings, err := securityintel.LoadWorkspaceSettings(root)
	if err != nil {
		return "", err
	}
	if err := settings.UpsertSuppression(suppression); err != nil {
		return "", err
	}
	if err := securityintel.SaveWorkspaceSettings(root, settings); err != nil {
		return "", err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// RemoveSuppression toglie una soppressione per identificativo advisory e salva.
func (s *SecurityIntel) RemoveSuppression(root string, advisoryID string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	settings, err := securityintel.LoadWorkspaceSettings(root)
	if err != nil {
		return "", err
	}
	if !settings.RemoveSuppression(advisoryID) {
		return "", fmt.Errorf("no suppression covers %s", advisoryID)
	}
	if err := securityintel.SaveWorkspaceSettings(root, settings); err != nil {
		return "", err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// UpgradeRequestJSON descrive una correzione da simulare o applicare.
type UpgradeRequestJSON struct {
	// Component è il componente da aggiornare, come appare nel finding.
	Component securityintel.Component `json:"component"`
	// TargetVersion è la versione a cui aggiornare.
	TargetVersion string `json:"targetVersion"`
	// Report è la scansione da cui leggere gli advisory correnti del componente.
	Report securityintel.ScanReport `json:"report"`
	// Options guida la consultazione delle fonti e i passi di verifica.
	Options ScanOptionsJSON `json:"options"`
}

// PreviewUpgrade simula l'aggiornamento di un componente a una versione target e
// restituisce in JSON l'impatto di sicurezza: quali advisory spariscono, quali restano
// e quali nuovi introduce l'aggiornamento. Non modifica alcun file.
func (s *SecurityIntel) PreviewUpgrade(root string, requestJSON string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	request, options, err := parseUpgradeRequest(requestJSON)
	if err != nil {
		return "", err
	}
	engine, _, err := securityEngineFor(root, options)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), securityScanTimeout)
	defer cancel()
	preview, err := engine.PreviewUpgrade(ctx, request.Report, request.Component, request.TargetVersion)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(preview)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// PlanUpgrade prepara la modifica del manifest per un aggiornamento e restituisce in
// JSON il piano: il diff da rivedere, l'impatto atteso e i passi di verifica, tutti
// ancora "idle". Non scrive alcun file: la modifica parte solo con RunUpgradeStep.
func (s *SecurityIntel) PlanUpgrade(root string, requestJSON string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	request, options, err := parseUpgradeRequest(requestJSON)
	if err != nil {
		return "", err
	}
	engine, settings, err := securityEngineFor(root, options)
	if err != nil {
		return "", err
	}
	request.Options = resolveOptionsFrom(options, settings)
	ctx, cancel := context.WithTimeout(context.Background(), securityScanTimeout)
	defer cancel()
	plan, err := s.plans.Plan(ctx, engine, request)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// RunUpgradeStep esegue un singolo passo di verifica del piano di remediation e
// restituisce il piano aggiornato in JSON, con lo stato e l'output del passo.
//
// Un passo che avvia un processo esterno viene eseguito solo con allowProcesses nelle
// opzioni: senza, risulta "skipped" con il motivo, mai eseguito silenziosamente.
func (s *SecurityIntel) RunUpgradeStep(root string, planID string, stepID string, optionsJSON string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	options := ScanOptionsJSON{}
	if optionsJSON != "" {
		if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
			return "", fmt.Errorf("invalid step options: %w", err)
		}
	}
	engine, settings, err := securityEngineFor(root, options)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), securityScanTimeout)
	defer cancel()
	plan, err := s.plans.RunStep(ctx, engine, planID, stepID, resolveOptionsFrom(options, settings))
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// FinishUpgrade chiude il piano di remediation: con apply true la modifica diventa
// definitiva, altrimenti il manifest torna esattamente com'era. La scelta è sempre
// dell'utente: il motore non applica mai una modifica senza conferma.
func (s *SecurityIntel) FinishUpgrade(root string, planID string, apply bool) (string, error) {
	if root == "" {
		return "", fmt.Errorf("no workspace folder selected")
	}
	plan, err := s.plans.Finish(planID, apply)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// parseUpgradeRequest decodifica la richiesta di aggiornamento e le sue opzioni.
func parseUpgradeRequest(payload string) (securityintel.UpgradeRequest, ScanOptionsJSON, error) {
	request := UpgradeRequestJSON{}
	if payload != "" {
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return securityintel.UpgradeRequest{}, ScanOptionsJSON{}, fmt.Errorf("invalid upgrade request: %w", err)
		}
	}
	return securityintel.UpgradeRequest{
		Component:     request.Component,
		TargetVersion: request.TargetVersion,
		Report:        request.Report,
	}, request.Options, nil
}

// securityEngineFor costruisce il motore con le impostazioni del workspace.
func securityEngineFor(root string, options ScanOptionsJSON) (*securityintel.Engine, securityintel.WorkspaceSettings, error) {
	settings, err := securityintel.LoadWorkspaceSettings(root)
	if err != nil {
		return nil, settings, err
	}
	engine, _ := buildSecurityEngine(options, settings)
	return engine, settings, nil
}

// resolveOptionsFrom unisce le opzioni della richiesta con quelle del workspace.
func resolveOptionsFrom(options ScanOptionsJSON, settings securityintel.WorkspaceSettings) securityintel.ResolveOptions {
	return securityintel.ResolveOptions{
		Offline:                   options.Offline || settings.Offline,
		AllowProcesses:            options.AllowProcesses,
		IncludePluginDependencies: options.IncludePluginDependencies || settings.IncludePluginDependencies,
		IncludeOptional:           options.IncludeOptional || settings.IncludeOptional,
	}
}

// buildSecurityEngine compone il motore con gli adapter e le fonti.
//
// Un solo motore, adapter per ecosistema: aggiungere package.json o Cargo.toml
// significa aggiungere una riga qui, non una seconda logica CVE.
func buildSecurityEngine(options ScanOptionsJSON, settings securityintel.WorkspaceSettings) (*securityintel.Engine, *securityintel.AdvisoryCache) {
	cache := securityintel.NewAdvisoryCache(securityintelCacheDirectory())
	overrides := map[string]string{}
	for key, value := range settings.SourceEndpoints {
		overrides[key] = value
	}
	for key, value := range options.SourceEndpoints {
		overrides[key] = value
	}
	osv := &securityintel.OSVSource{Endpoint: overrides["osv"], Cache: cache}
	sources := []securityintel.Source{osv}
	enrichers := []securityintel.Enricher{
		&securityintel.EPSSSource{Endpoint: overrides["epss"]},
		&securityintel.KEVSource{Endpoint: overrides["kev"]},
	}
	adapters := []securityintel.EcosystemAdapter{maven.New(), gomod.New()}
	return securityintel.New(adapters, sources, enrichers, cache), cache
}

// selectedEcosystems unisce i filtri delle opzioni e della configurazione.
func selectedEcosystems(fromOptions []string, fromSettings []securityintel.Ecosystem) []securityintel.Ecosystem {
	seen := map[securityintel.Ecosystem]bool{}
	result := []securityintel.Ecosystem{}
	for _, value := range append(append([]string{}, fromOptions...), ecosystemStrings(fromSettings)...) {
		ecosystem := securityintel.Ecosystem(value)
		if ecosystem == "" || seen[ecosystem] {
			continue
		}
		seen[ecosystem] = true
		result = append(result, ecosystem)
	}
	return result
}

func ecosystemStrings(values []securityintel.Ecosystem) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, string(value))
	}
	return result
}

// securityintelCacheDirectory è la cartella del database locale degli advisory.
func securityintelCacheDirectory() string {
	return filepath.Join(dataDir(), "securityintel")
}
