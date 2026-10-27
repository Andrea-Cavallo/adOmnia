// Package toolmanifest è il contratto generico delle installazioni gestite verificate di adOmnia
// (PY-8.3, RS-9.4). Ogni adapter che installa uno strumento nella cartella strumenti lega quella
// cartella al report che l'ha prodotta: alla prima verifica riuscita salva un manifest con gli
// hash degli artefatti, e da quel momento una cartella diversa (report sostituito, versione
// cambiata, artefatto mancante) non viene più usata. Un'installazione senza report non è
// verificabile: si reinstalla con un solo comando visibile, mai in silenzio.
//
// Estratto da internal/languages/python (primo consumatore: il report di `pip install --report`)
// quando il debugger Rust CodeLLDB (RS-9.4) è diventato il secondo: i due adapter condividono il
// formato del manifest invece di duplicarlo. Il parsing del report di installazione resta di ogni
// adapter: pip ha il suo formato, gli installer con checksum pinnato scrivono un Report.
package toolmanifest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"os"
	"reflect"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

const (
	// ReportFile è il report di installazione nella cartella strumenti: quello di pip per Python,
	// un Report nel formato generico per gli installer con checksum pinnato.
	ReportFile = "install-report.json"
	// ManifestFile è il manifest salvato da adOmnia alla prima verifica riuscita.
	ManifestFile = "adomnia-tool.json"
)

// Artifact è un artefatto scaricato e verificato, con l'hash calcolato sul file ricevuto.
type Artifact struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
}

// Manifest lega la cartella strumenti installata al report che l'ha prodotta.
type Manifest struct {
	Tool         string     `json:"tool"`
	Version      string     `json:"version"`
	Artifacts    []Artifact `json:"artifacts"`
	ReportSHA256 string     `json:"reportSHA256"`
}

// Report è il report di installazione nel formato generico: lo scrive il comando di installazione
// dopo aver verificato il checksum dell'artefatto scaricato, e lo rilegge la verifica.
type Report struct {
	Tool      string     `json:"tool"`
	Version   string     `json:"version"`
	Artifacts []Artifact `json:"artifacts"`
}

// ParseReport legge e valida un Report generico: strumento e versione noti e, per ogni artefatto,
// nome, versione e una SHA-256 valida. Un report senza hash non è accettabile: senza hash non c'è
// nulla da verificare.
func ParseReport(data []byte) (Report, error) {
	var report Report
	if err := json.Unmarshal(data, &report); err != nil {
		return Report{}, fmt.Errorf("the install report is unreadable: %w", err)
	}
	report.Tool = strings.TrimSpace(report.Tool)
	report.Version = strings.TrimSpace(report.Version)
	if report.Tool == "" || report.Version == "" {
		return Report{}, fmt.Errorf("the install report has no tool or version")
	}
	if len(report.Artifacts) == 0 {
		return Report{}, fmt.Errorf("the install report lists no artifacts")
	}
	for index := range report.Artifacts {
		artifact := &report.Artifacts[index]
		artifact.Name = strings.TrimSpace(artifact.Name)
		artifact.Version = strings.TrimSpace(artifact.Version)
		artifact.SHA256 = strings.ToLower(strings.TrimSpace(artifact.SHA256))
		if artifact.Name == "" || artifact.Version == "" {
			return Report{}, fmt.Errorf("an artifact in the install report has no name or version")
		}
		if !IsSHA256(artifact.SHA256) {
			return Report{}, fmt.Errorf("artifact %s %s has no valid SHA-256 in the install report", artifact.Name, artifact.Version)
		}
	}
	return report, nil
}

// Ensure scrive il manifest alla prima verifica riuscita e poi lo confronta con il report corrente:
// un report, un artefatto o una versione diversi richiedono una nuova installazione.
func Ensure(path, tool, version string, artifacts []Artifact, report []byte) error {
	expected := Manifest{Tool: tool, Version: version, Artifacts: artifacts, ReportSHA256: Digest(report)}
	if existing, err := os.ReadFile(path); err == nil {
		var parsed Manifest
		if err := json.Unmarshal(existing, &parsed); err != nil {
			return fmt.Errorf("the %s manifest is unreadable (%v): reinstall it from the editor notice", tool, err)
		}
		if !reflect.DeepEqual(parsed, expected) {
			return fmt.Errorf("the installed %s does not match its verified manifest: the tools folder changed, reinstall it from the editor notice", tool)
		}
		return nil
	}
	encoded, err := jsonutil.Marshal(expected, jsontext.WithIndent("  "))
	if err != nil {
		return fmt.Errorf("could not record the %s manifest: %w", tool, err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
		return fmt.Errorf("could not record the %s manifest: %w", tool, err)
	}
	return nil
}

// IsSHA256 dice se value è un digest SHA-256 esadecimale.
func IsSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// Digest è la SHA-256 esadecimale di data.
func Digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
