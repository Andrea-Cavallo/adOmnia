package securityintel

import (
	"adomnia/internal/jsonutil"
	"encoding/json/jsontext"
	"fmt"
	"html"
	"net/url"
	"strings"
	"time"
)

// Formati di esportazione supportati.
const (
	FormatJSON     = "json"
	FormatSARIF    = "sarif"
	FormatHTML     = "html"
	FormatCyclone  = "cyclonedx"
	FormatSPDX     = "spdx"
	FormatVEX      = "vex"
	FormatMarkdown = "markdown"
)

// SupportedFormats è l'elenco dei formati che l'utente può esportare.
var SupportedFormats = []string{FormatJSON, FormatSARIF, FormatHTML, FormatCyclone, FormatSPDX, FormatVEX, FormatMarkdown}

// FileExtension è l'estensione del file per un formato.
func FileExtension(format string) string {
	switch format {
	case FormatSARIF:
		return ".sarif"
	case FormatHTML:
		return ".html"
	case FormatCyclone:
		return ".cdx.json"
	case FormatSPDX:
		return ".spdx.json"
	case FormatVEX:
		return ".vex.json"
	case FormatMarkdown:
		return ".md"
	default:
		return ".json"
	}
}

// Export serializza il report nel formato richiesto.
func Export(report ScanReport, format string) ([]byte, error) {
	switch format {
	case FormatJSON:
		return jsonutil.Marshal(report, jsontext.WithIndent("  "))
	case FormatSARIF:
		return marshalIndent(SARIFOf(report))
	case FormatCyclone:
		return marshalIndent(CycloneDXOf(report))
	case FormatSPDX:
		return marshalIndent(SPDXOf(report))
	case FormatVEX:
		return marshalIndent(VEXOf(report))
	case FormatHTML:
		return []byte(HTMLReport(report)), nil
	case FormatMarkdown:
		return []byte(MarkdownReport(report)), nil
	default:
		return nil, fmt.Errorf("unsupported export format: %s", format)
	}
}

func marshalIndent(value any) ([]byte, error) {
	return jsonutil.Marshal(value, jsontext.WithIndent("  "))
}

// SARIFReport è il documento SARIF 2.1.0 prodotto dal report.
type SARIFReport struct {
	Schema  string     `json:"$schema"`
	Version string     `json:"version"`
	Runs    []sarifRun `json:"runs"`
}

type sarifRun struct {
	Tool    sarifTool     `json:"tool"`
	Results []sarifResult `json:"results"`
}

type sarifTool struct {
	Driver sarifDriver `json:"driver"`
}

type sarifDriver struct {
	Name           string      `json:"name"`
	InformationURI string      `json:"informationUri"`
	Version        string      `json:"version,omitempty"`
	Rules          []sarifRule `json:"rules,omitempty"`
}

type sarifRule struct {
	ID               string     `json:"id"`
	Name             string     `json:"name,omitempty"`
	ShortDescription *sarifText `json:"shortDescription,omitempty"`
	HelpURI          string     `json:"helpUri,omitempty"`
}

// sarifText è un messaggio SARIF, sempre in forma di testo.
type sarifText struct {
	Text string `json:"text"`
}

type sarifResult struct {
	RuleID     string          `json:"ruleId"`
	Level      string          `json:"level"`
	Message    sarifMessage    `json:"message"`
	Locations  []sarifLocation `json:"locations,omitempty"`
	Properties map[string]any  `json:"properties,omitempty"`
}

type sarifMessage struct {
	Text string `json:"text"`
}

type sarifLocation struct {
	PhysicalLocation struct {
		ArtifactLocation struct {
			URI string `json:"uri"`
		} `json:"artifactLocation"`
		Region *struct {
			StartLine int `json:"startLine"`
		} `json:"region,omitempty"`
	} `json:"physicalLocation"`
}

// SARIFOf traduce il report in SARIF 2.1.0, il formato che i sistemi di code review
// (GitHub, GitLab, Sonar) importano nei propri check di sicurezza.
func SARIFOf(report ScanReport) SARIFReport {
	run := sarifRun{Tool: sarifTool{Driver: sarifDriver{
		Name:           "adOmnia Security Intelligence",
		InformationURI: "https://adomnia.local/security",
		Version:        report.Tool,
		Rules:          []sarifRule{},
	}}}
	seenRules := map[string]bool{}
	for _, finding := range report.Findings {
		id := CanonicalAdvisoryID(finding.Advisory)
		if !seenRules[id] {
			seenRules[id] = true
			summary := finding.Advisory.Summary
			if summary == "" {
				summary = id
			}
			helpURI := ""
			if len(finding.Advisory.References) > 0 {
				helpURI = finding.Advisory.References[0]
			}
			run.Tool.Driver.Rules = append(run.Tool.Driver.Rules, sarifRule{
				ID:               id,
				Name:             id,
				ShortDescription: &sarifText{Text: summary},
				HelpURI:          helpURI,
			})
		}
		level := "warning"
		switch finding.Risk.Band {
		case BandCritical, BandHigh:
			level = "error"
		case BandLow, BandInformational:
			level = "note"
		}
		result := sarifResult{
			RuleID: id,
			Level:  level,
			Message: sarifMessage{Text: fmt.Sprintf("%s %s is affected by %s (%s). %s",
				finding.Component.Name, finding.Component.Version, id, finding.Advisory.Severity.Class(), finding.Remediation.Note)},
			Properties: map[string]any{
				"priority":     finding.Risk.Priority,
				"band":         finding.Risk.Band,
				"cvss":         finding.Advisory.Severity.Score(),
				"epss":         finding.Advisory.Severity.EPSS,
				"kev":          finding.Advisory.Severity.KEV,
				"reachability": finding.Reachability,
				"exposure":     finding.Component.Exposure,
				"fixedVersion": finding.Remediation.FixedVersion,
			},
		}
		if len(finding.Evidence.CallPaths) > 0 && len(finding.Evidence.CallPaths[0]) > 0 {
			frame := finding.Evidence.CallPaths[0][0]
			if frame.File != "" {
				uri := frame.File
				if frame.Relative != "" {
					uri = frame.Relative
				}
				location := sarifLocation{}
				location.PhysicalLocation.ArtifactLocation.URI = uri
				region := struct {
					StartLine int `json:"startLine"`
				}{StartLine: frame.Line}
				location.PhysicalLocation.Region = &region
				result.Locations = []sarifLocation{location}
			}
		}
		run.Results = append(run.Results, result)
	}
	if run.Results == nil {
		run.Results = []sarifResult{}
	}
	return SARIFReport{
		Schema:  "https://json.schemastore.org/sarif-2.1.0.json",
		Version: "2.1.0",
		Runs:    []sarifRun{run},
	}
}

// CycloneDXBOM è un SBOM in formato CycloneDX 1.5, con le vulnerabilità note.
type CycloneDXBOM struct {
	BOMFormat       string                 `json:"bomFormat"`
	SpecVersion     string                 `json:"specVersion"`
	Version         int                    `json:"version"`
	Metadata        cycloneMetadata        `json:"metadata"`
	Components      []cycloneComponent     `json:"components"`
	Vulnerabilities []cycloneVulnerability `json:"vulnerabilities,omitempty"`
}

type cycloneMetadata struct {
	Timestamp string        `json:"timestamp"`
	Tools     []cycloneTool `json:"tools"`
}

type cycloneTool struct {
	Name string `json:"name"`
}

type cycloneComponent struct {
	Type    string `json:"type"`
	Group   string `json:"group,omitempty"`
	Name    string `json:"name"`
	Version string `json:"version"`
	PURL    string `json:"purl,omitempty"`
	Scope   string `json:"scope,omitempty"`
	BOMRef  string `json:"bom-ref,omitempty"`
}

type cycloneVulnerability struct {
	ID          string             `json:"id"`
	Source      cycloneSource      `json:"source"`
	Description string             `json:"description,omitempty"`
	Ratings     []cycloneRating    `json:"ratings,omitempty"`
	Affects     []cycloneAffects   `json:"affects,omitempty"`
	References  []cycloneReference `json:"references,omitempty"`
	Analysis    *cycloneAnalysis   `json:"analysis,omitempty"`
}

type cycloneSource struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

type cycloneRating struct {
	Score    float64 `json:"score,omitzero"`
	Severity string  `json:"severity,omitempty"`
	Method   string  `json:"method,omitempty"`
	Vector   string  `json:"vector,omitempty"`
}

type cycloneAffects struct {
	Ref string `json:"ref"`
}

type cycloneReference struct {
	ID     string        `json:"id"`
	Source cycloneSource `json:"source"`
}

// CycloneDXOf costruisce l'SBOM CycloneDX del workspace.
func CycloneDXOf(report ScanReport) CycloneDXBOM {
	sbom := CycloneDXBOM{
		BOMFormat:   "CycloneDX",
		SpecVersion: "1.5",
		Version:     1,
		Metadata: cycloneMetadata{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Tools:     []cycloneTool{{Name: "adOmnia Security Intelligence"}},
		},
		Components: []cycloneComponent{},
	}
	seen := map[string]bool{}
	for _, unit := range report.Units {
		for _, component := range unit.Components {
			ref := PackageURL(component)
			if seen[ref] {
				continue
			}
			seen[ref] = true
			group, name := splitCoordinate(component.Name)
			sbom.Components = append(sbom.Components, cycloneComponent{
				Type:    "library",
				Group:   group,
				Name:    name,
				Version: component.Version,
				PURL:    ref,
				Scope:   cycloneScope(component.Scope),
				BOMRef:  ref,
			})
		}
	}
	for _, finding := range report.Findings {
		id := CanonicalAdvisoryID(finding.Advisory)
		vulnerability := cycloneVulnerability{
			ID:          id,
			Source:      cycloneSource{Name: strings.Join(finding.Advisory.Sources, ", ")},
			Description: finding.Advisory.Details,
			Affects:     []cycloneAffects{{Ref: PackageURL(finding.Component)}},
			Ratings: []cycloneRating{{
				Score:    finding.Advisory.Severity.Score(),
				Severity: strings.ToLower(finding.Advisory.Severity.Class()),
				Method:   cycloneMethod(finding.Advisory.Severity),
				Vector:   severityVector(finding.Advisory.Severity),
			}},
		}
		if vulnerability.Description == "" {
			vulnerability.Description = finding.Advisory.Summary
		}
		for _, reference := range finding.Advisory.References {
			vulnerability.References = append(vulnerability.References, cycloneReference{ID: reference, Source: cycloneSource{Name: "advisory", URL: reference}})
		}
		sbom.Vulnerabilities = append(sbom.Vulnerabilities, vulnerability)
	}
	return sbom
}

// SPDXOf produce un documento SPDX 2.3 compatto: lo standard che gli elenchi di
// conformità software chiedono sempre più spesso.
func SPDXOf(report ScanReport) map[string]any {
	packages := []map[string]any{}
	for _, unit := range report.Units {
		for _, component := range unit.Components {
			group, name := splitCoordinate(component.Name)
			packages = append(packages, map[string]any{
				"SPDXID":           "SPDXRef-" + sanitizeID(component.Key()),
				"name":             name,
				"versionInfo":      component.Version,
				"supplier":         "NOASSERTION",
				"downloadLocation": "NOASSERTION",
				"licenseConcluded": "NOASSERTION",
				"externalRefs": []map[string]any{{
					"referenceCategory": "PACKAGE-MANAGER",
					"referenceType":     "purl",
					"referenceLocator":  PackageURL(component),
				}},
				"comment": group,
			})
		}
	}
	return map[string]any{
		"spdxVersion":       "SPDX-2.3",
		"dataLicense":       "CC0-1.0",
		"SPDXID":            "SPDXRef-DOCUMENT",
		"name":              report.Workspace,
		"documentNamespace": "https://adomnia.local/spdx/" + url.PathEscape(report.ScannedAt),
		"creationInfo": map[string]any{
			"created":            report.ScannedAt,
			"creators":           []string{"Tool: adOmnia Security Intelligence"},
			"licenseListVersion": "3.21",
		},
		"packages": packages,
	}
}

// PackageURL è il purl di un componente, lo standard che identifica un pacchetto in
// modo univoco fra ecosistemi.
func PackageURL(component Component) string {
	switch component.Ecosystem {
	case EcosystemMaven:
		group, name := splitCoordinate(component.Name)
		return fmt.Sprintf("pkg:maven/%s/%s@%s", url.PathEscape(group), url.PathEscape(name), url.PathEscape(component.Version))
	case EcosystemGo:
		return fmt.Sprintf("pkg:golang/%s@%s", url.PathEscape(component.Name), url.PathEscape(component.Version))
	case EcosystemPyPI:
		return fmt.Sprintf("pkg:pypi/%s@%s", url.PathEscape(component.Name), url.PathEscape(component.Version))
	default:
		return fmt.Sprintf("pkg:generic/%s@%s", url.PathEscape(component.Name), url.PathEscape(component.Version))
	}
}

// splitCoordinate separa "group:artifact" nelle sue parti. Per Go il group è vuoto.
func splitCoordinate(name string) (string, string) {
	group, artifact, found := strings.Cut(name, ":")
	if !found {
		return "", name
	}
	return group, artifact
}

// cycloneScope traduce lo scope del motore nello scope CycloneDX.
func cycloneScope(scope Scope) string {
	switch scope {
	case ScopeTest:
		return "optional"
	case ScopeProvided, ScopeBuild, ScopeToolchain:
		return "required"
	default:
		return "required"
	}
}

// cycloneMethod indica il metodo di punteggio usato.
func cycloneMethod(severity Severity) string {
	switch {
	case severity.CVSS40Vector != "" || severity.CVSS40Score > 0:
		return "CVSSv40"
	case severity.CVSS31Vector != "" || severity.CVSS31Score > 0:
		return "CVSSv31"
	default:
		return "other"
	}
}

func severityVector(severity Severity) string {
	if severity.CVSS40Vector != "" {
		return severity.CVSS40Vector
	}
	return severity.CVSS31Vector
}

// sanitizeID rende un identificativo valido per gli ID SPDX.
func sanitizeID(value string) string {
	var builder strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9', char == '.', char == '-':
			builder.WriteRune(char)
		default:
			builder.WriteByte('-')
		}
	}
	return builder.String()
}

// HTMLReport produce un report HTML autonomo: un file che si apre, si stampa e si
// invia, senza dipendere da adOmnia o da una rete.
func HTMLReport(report ScanReport) string {
	var builder strings.Builder
	builder.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>adOmnia Security Intelligence — ` + html.EscapeString(report.Workspace) + `</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px; max-width: 1100px; margin-inline: auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; }
.meta { opacity: .7; font-size: 12px; margin-bottom: 24px; }
.stats { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0 8px; }
.stat { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 10px 16px; min-width: 110px; }
.stat b { display: block; font-size: 22px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid rgba(128,128,128,.22); vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid transparent; }
.critical { background: rgba(220,38,38,.16); color: #dc2626; border-color: rgba(220,38,38,.32); }
.high { background: rgba(234,88,12,.16); color: #ea580c; border-color: rgba(234,88,12,.32); }
.medium { background: rgba(202,138,4,.16); color: #ca8a04; border-color: rgba(202,138,4,.32); }
.low { background: rgba(21,128,61,.16); color: #15803d; border-color: rgba(21,128,61,.32); }
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
.reasons { margin: 4px 0 0; padding-left: 16px; opacity: .8; font-size: 12px; }
</style>
</head>
<body>
<h1>adOmnia Security Intelligence</h1>
<div class="meta">` + html.EscapeString(report.Workspace) + ` · scanned ` + html.EscapeString(report.ScannedAt) + `</div>
<div class="stats">
<div class="stat"><b>` + fmt.Sprint(report.Summary.Findings) + `</b>findings</div>
<div class="stat"><b>` + fmt.Sprint(report.Summary.Critical) + `</b>critical</div>
<div class="stat"><b>` + fmt.Sprint(report.Summary.High) + `</b>high</div>
<div class="stat"><b>` + fmt.Sprint(report.Summary.ActivelyExploited) + `</b>exploited in the wild</div>
<div class="stat"><b>` + fmt.Sprint(report.Summary.Reachable) + `</b>reachable</div>
<div class="stat"><b>` + fmt.Sprint(report.Summary.FixAvailable) + `</b>with a fix</div>
</div>
<h2>Findings</h2>
<table>
<thead><tr><th>Priority</th><th>Vulnerability</th><th>Component</th><th>Reachability</th><th>Fix</th></tr></thead>
<tbody>`)
	for _, finding := range report.Findings {
		builder.WriteString("<tr><td><span class=\"badge " + html.EscapeString(finding.Risk.Band) + "\">" +
			html.EscapeString(finding.Risk.Priority) + "</span></td>")
		builder.WriteString("<td><b>" + html.EscapeString(CanonicalAdvisoryID(finding.Advisory)) + "</b><br>" +
			html.EscapeString(finding.Advisory.Summary) + "<ul class=\"reasons\">")
		for _, reason := range finding.Risk.Reasons {
			builder.WriteString("<li>" + html.EscapeString(reason) + "</li>")
		}
		builder.WriteString("</ul></td>")
		builder.WriteString("<td class=\"mono\">" + html.EscapeString(finding.Component.Name) + "<br>" +
			html.EscapeString(finding.Component.Version) + "</td>")
		builder.WriteString("<td>" + html.EscapeString(finding.Reachability.Label()) + "</td>")
		builder.WriteString("<td class=\"mono\">" + html.EscapeString(finding.Remediation.FixedVersion) + "</td></tr>")
	}
	builder.WriteString(`</tbody></table>
<h2>Data sources</h2>
<table><thead><tr><th>Source</th><th>Endpoint</th><th>Last updated</th></tr></thead><tbody>`)
	for _, source := range report.Sources {
		builder.WriteString("<tr><td>" + html.EscapeString(source.Name) + "</td><td class=\"mono\">" +
			html.EscapeString(source.Endpoint) + "</td><td>" + html.EscapeString(source.LastUpdated) + "</td></tr>")
	}
	builder.WriteString(`</tbody></table>
</body>
</html>`)
	return builder.String()
}
