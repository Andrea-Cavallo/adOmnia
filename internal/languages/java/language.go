// Package java è il language adapter di Java (Maven e Gradle) dell'IDE di adOmnia.
//
// Dipende dal core (internal/ide/...) e mai dall'host internal/codestudio. Questo primo passo riconosce
// le unità di build, il JDK e propone le configurazioni di run/test/build; language server, test
// strutturati e debug arrivano con i passi successivi di mds/MULTILANGUAGE-IDE.md (Fase 9.4).
package java

import (
	"path/filepath"
	"strings"
)

// ID è salvato in project.Unit.Language e nelle configurazioni di run.
const ID = "java"

// Tipi di unità Java.
const (
	UnitMaven  = "maven"  // cartella con pom.xml
	UnitGradle = "gradle" // cartella con build.gradle(.kts)
)

// Language implementa language.Language, DocumentSelector, ProjectDetector e run.SuggestionProvider.
type Language struct{}

func New() *Language { return &Language{} }

func (*Language) ID() string   { return ID }
func (*Language) Name() string { return "Java" }

// DocumentLanguageID restituisce il languageId LSP dei sorgenti Java.
func (*Language) DocumentLanguageID(path string) (string, bool) {
	if strings.EqualFold(filepath.Ext(path), ".java") {
		return "java", true
	}
	return "", false
}
