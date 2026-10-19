package securityintel

import (
	"fmt"
	"strings"
)

// MarkdownReport è il report in Markdown: riepilogo, poi un problema per sezione con componente, raggiungibilità e fix.
// Pensato per essere letto, versionato e incollato in una issue o in un'AI per farsi proporre le correzioni.
func MarkdownReport(report ScanReport) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# Dependency security report\n\n- **Workspace:** %s\n- **Scanned:** %s\n", report.Workspace, report.ScannedAt)
	s := report.Summary
	fmt.Fprintf(&out, "- **Findings:** %d (critical %d, high %d, medium %d, low %d, other %d)\n", s.Findings, s.Critical, s.High, s.Medium, s.Low, s.Other)
	fmt.Fprintf(&out, "- **Actively exploited:** %d · **Reachable code:** %d · **Fix available:** %d · **Suppressed:** %d\n\n", s.ActivelyExploited, s.Reachable, s.FixAvailable, s.Ignored)
	if len(report.Findings) == 0 {
		out.WriteString("No known vulnerabilities.\n")
		return out.String()
	}
	out.WriteString("## Summary\n\n| Priority | Vulnerability | Component | Reachability | Fix |\n| --- | --- | --- | --- | --- |\n")
	for _, f := range report.Findings {
		fmt.Fprintf(&out, "| %s | %s | %s %s | %s | %s |\n", f.Risk.Band, cell(f.Advisory.ID), cell(f.Component.Name), cell(f.Component.Version), f.Reachability, fixOf(f))
	}
	out.WriteString("\n## Findings\n")
	for _, f := range report.Findings {
		status := ""
		if f.Ignored != nil {
			status = " _(suppressed)_"
		}
		fmt.Fprintf(&out, "\n### %s — %s%s\n\n", f.Advisory.ID, firstNonEmpty(f.Advisory.Summary, "vulnerability"), status)
		fmt.Fprintf(&out, "- **Priority:** %s\n- **Component:** `%s` %s (%s)\n- **Reachability:** %s\n- **Fix:** %s\n", f.Risk.Band, f.Component.Name, f.Component.Version, originOf(f), f.Reachability, fixOf(f))
		if len(f.Advisory.Aliases) > 0 {
			fmt.Fprintf(&out, "- **Aliases:** %s\n", strings.Join(f.Advisory.Aliases, ", "))
		}
		if f.Remediation.IndirectVia != "" {
			fmt.Fprintf(&out, "- **Brought in by:** %s\n", f.Remediation.IndirectVia)
		}
		for _, reference := range f.Advisory.References {
			fmt.Fprintf(&out, "- %s\n", reference)
		}
	}
	return out.String()
}

func originOf(f Finding) string {
	if f.Component.Direct {
		return "direct"
	}
	return "transitive"
}

func fixOf(f Finding) string {
	if f.Remediation.FixedVersion == "" {
		return "none published"
	}
	return "upgrade to " + f.Remediation.FixedVersion
}

func cell(value string) string { return strings.ReplaceAll(value, "|", `\|`) }

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return strings.ReplaceAll(strings.TrimSpace(value), "\n", " ")
		}
	}
	return ""
}
