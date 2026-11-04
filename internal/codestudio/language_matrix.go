package codestudio

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

// CapabilityMatrixMarkdown renders the capabilities the registered adapters
// actually implement. It is generated from the same registry the application
// uses, so a new language or a new interface implementation cannot leave the
// published matrix behind (docs/LANGUAGE-CAPABILITY-MATRIX.md, test
// TestCapabilityMatrixDocumentMatchesRegistry).
func CapabilityMatrixMarkdown() string {
	adapters := newLanguageRegistry().All()
	sorted := append([]language.Language(nil), adapters...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Name() != sorted[j].Name() {
			return sorted[i].Name() < sorted[j].Name()
		}
		return sorted[i].ID() < sorted[j].ID()
	})
	var rows strings.Builder
	rows.WriteString("| Language | ID | Project detection | Documents | Language server | Run | Tests | Debug | Declarations | Usages |\n")
	rows.WriteString("|---|---|---|---|---|---|---|---|---|---|\n")
	for _, adapter := range sorted {
		capabilities := language.CapabilitiesOf(adapter)
		fmt.Fprintf(&rows, "| %s | `%s` | %s | %s | %s | %s | %s | %s | %s | %s |\n",
			escapeCell(adapter.Name()),
			adapter.ID(),
			yesNo(capabilities.ProjectDetection),
			yesNo(capabilities.Documents),
			yesNo(capabilities.LanguageServer),
			yesNo(capabilities.Run),
			yesNo(capabilities.Tests),
			yesNo(capabilities.Debug),
			yesNo(capabilities.Declarations),
			yesNo(capabilities.Usages),
		)
	}
	return rows.String()
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "—"
}

func escapeCell(value string) string {
	return strings.ReplaceAll(value, "|", `\|`)
}
