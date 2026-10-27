package python

import (
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
)

// Artefatti verificati dell'installazione gestita (PY-8.3).
//
// L'installazione avviene con pip e `--report`: pip scrive, per ogni artefatto scaricato (wheel o
// sdist, dipendenze comprese), URL, versione e SHA-256 del file ricevuto. adOmnia non può pinnare
// gli hash a priori — le ruote dipendono da piattaforma e versione di Python — ma può legare la
// cartella strumenti al report che l'ha prodotta: alla prima verifica riuscita salva un manifest con
// gli hash, e da quel momento una cartella diversa (report sostituito, versione cambiata, artefatto
// mancante) non viene più usata. Un'installazione senza report, o fatta con la vecchia procedura,
// non è verificabile: si reinstalla con un solo comando visibile, mai in silenzio.
//
// I file installati non vengono riletti a ogni avvio: pip scrive le SHA-256 dei file in RECORD
// dentro il dist-info, ed è quello il riferimento per l'integrità del contenuto.
//
// Il formato del manifest e la scrittura/comparazione sono il contratto generico
// (internal/ide/toolmanifest, estratto da qui quando CodeLLDB è diventato il secondo consumer,
// RS-9.4): qui restano solo il formato del report di pip e la verifica del dist-info installato.
const (
	// installReportFile è il report di pip (`pip install --report`) nella cartella strumenti.
	installReportFile = toolmanifest.ReportFile
	// toolManifestFile è l'impronta salvata da adOmnia alla prima verifica riuscita.
	toolManifestFile = toolmanifest.ManifestFile
)

// toolArtifact e toolManifest sono il formato generico condiviso (internal/ide/toolmanifest).
type (
	toolArtifact = toolmanifest.Artifact
	toolManifest = toolmanifest.Manifest
)

// pipInstallReport è la parte di report di pip che serve: `install` è l'elenco degli artefatti
// effettivamente usati per questa installazione.
type pipInstallReport struct {
	Install []struct {
		Metadata struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"metadata"`
		Download struct {
			URL         string `json:"url"`
			ArchiveInfo struct {
				Hashes map[string]string `json:"hashes"`
				// Hash è il formato dei report precedenti al campo `hashes`: "sha256=<hex>".
				Hash string `json:"hash"`
			} `json:"archive_info"`
		} `json:"download_info"`
	} `json:"install"`
}

// verifyManagedTool controlla che il server gestito sia quello installato e verificato: report di pip
// leggibile e completo, versione installata uguale a quella pinnata, manifest uguale al report.
// Restituisce un errore che dice cosa fare (reinstallare), mai un "non disponibile" generico.
func verifyManagedTool(directory string) error {
	reportPath := filepath.Join(directory, installReportFile)
	report, err := os.ReadFile(reportPath)
	if err != nil {
		return fmt.Errorf("the installed %s has no verification report (%s): reinstall it from the editor notice", pyrightName, installReportFile)
	}
	artifacts, err := parsePipInstallReport(report)
	if err != nil {
		return fmt.Errorf("the installed %s is not verified: %w. Reinstall it from the editor notice", pyrightName, err)
	}
	if err := verifyInstalledVersion(directory); err != nil {
		return err
	}
	return toolmanifest.Ensure(filepath.Join(directory, toolManifestFile), pyrightName, pyrightVersion, artifacts, report)
}

// parsePipInstallReport estrae gli artefatti dal report di pip: ognuno deve dichiarare nome,
// versione e una SHA-256 valida, e la versione del server deve essere quella pinnata. Un report
// incompleto non è accettabile: senza hash non c'è nulla da verificare.
func parsePipInstallReport(report []byte) ([]toolArtifact, error) {
	var parsed pipInstallReport
	if err := json.Unmarshal(report, &parsed); err != nil {
		return nil, fmt.Errorf("the pip install report is unreadable: %v", err)
	}
	if len(parsed.Install) == 0 {
		return nil, fmt.Errorf("the pip install report lists no artifacts")
	}
	artifacts := make([]toolArtifact, 0, len(parsed.Install))
	serverVersion := ""
	for _, entry := range parsed.Install {
		name := strings.TrimSpace(entry.Metadata.Name)
		version := strings.TrimSpace(entry.Metadata.Version)
		if name == "" || version == "" {
			return nil, fmt.Errorf("an artifact in the pip install report has no name or version")
		}
		hash := artifactHash(entry.Download.ArchiveInfo.Hashes, entry.Download.ArchiveInfo.Hash)
		if !toolmanifest.IsSHA256(hash) {
			return nil, fmt.Errorf("artifact %s %s has no valid SHA-256 in the pip install report", name, version)
		}
		if strings.EqualFold(name, pyrightName) {
			serverVersion = version
		}
		artifacts = append(artifacts, toolArtifact{Name: name, Version: version, URL: entry.Download.URL, SHA256: strings.ToLower(hash)})
	}
	if serverVersion == "" {
		return nil, fmt.Errorf("the pip install report does not contain %s", pyrightName)
	}
	if serverVersion != pyrightVersion {
		return nil, fmt.Errorf("the report contains %s, while the pinned version is %s", serverVersion, pyrightVersion)
	}
	return artifacts, nil
}

// artifactHash legge l'hash dal formato nuovo (`hashes`) o da quello precedente (`hash`).
func artifactHash(hashes map[string]string, legacy string) string {
	for algorithm, value := range hashes {
		if strings.EqualFold(algorithm, "sha256") {
			return value
		}
	}
	if algorithm, value, found := strings.Cut(legacy, "="); found && strings.EqualFold(algorithm, "sha256") {
		return value
	}
	return ""
}

// verifyInstalledVersion legge la versione dal dist-info installato: il report dice cosa è stato
// scaricato, questo dice cosa c'è davvero nella cartella strumenti.
func verifyInstalledVersion(directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("could not read the tools folder %s: %w", directory, err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(strings.ToLower(entry.Name()), pyrightName+"-") || !strings.HasSuffix(entry.Name(), ".dist-info") {
			continue
		}
		metadata, err := os.ReadFile(filepath.Join(directory, entry.Name(), "METADATA"))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(metadata), "\n") {
			version, found := strings.CutPrefix(strings.TrimSpace(line), "Version:")
			if !found {
				continue
			}
			version = strings.TrimSpace(version)
			if version != pyrightVersion {
				return fmt.Errorf("the installed %s is %s, not the pinned %s: reinstall it from the editor notice", pyrightName, version, pyrightVersion)
			}
			return nil
		}
	}
	return fmt.Errorf("the installed %s has no version metadata: reinstall it from the editor notice", pyrightName)
}
