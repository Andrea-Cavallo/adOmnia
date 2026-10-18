package java

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
)

// MainSource dice chi ha deciso che una classe è lanciabile.
const (
	// MainSourceJDT: JDT LS (vscode.java.resolveMainClass) — la verità, anche per `main` senza `public`, istanza, compact source.
	MainSourceJDT = "jdt"
	// MainSourceScan: le regex di mains.go, solo quando JDT LS non è pronto.
	MainSourceScan = "scan"
)

// MainClassInfo è una classe lanciabile con chi l'ha decisa.
type MainClassInfo struct {
	Class       string `json:"class"`
	ProjectName string `json:"projectName,omitempty"`
	File        string `json:"file,omitempty"`
	Spring      bool   `json:"spring,omitempty"`
	Source      string `json:"source"`
}

// ParseResolveMainClass legge la risposta di `vscode.java.resolveMainClass`: [{mainClass, projectName, filePath}].
func ParseResolveMainClass(raw json.RawMessage) []MainClassInfo {
	var items []struct {
		MainClass   string `json:"mainClass"`
		ProjectName string `json:"projectName"`
		FilePath    string `json:"filePath"`
	}
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	found := make([]MainClassInfo, 0, len(items))
	for _, item := range items {
		if ValidClassName(item.MainClass) {
			found = append(found, MainClassInfo{Class: item.MainClass, ProjectName: item.ProjectName, File: filepath.ToSlash(item.FilePath), Source: MainSourceJDT})
		}
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].Class < found[j].Class })
	return found
}

// ScanMainClasses è il fallback senza server: le regex di mains.go su un'unità, marcate come tali.
// fallback: JDT decide quando è ready (JS-6) — nessun altro codice deve decidere cos'è una `main`.
func ScanMainClasses(unitRoot string) []MainClassInfo {
	var found []MainClassInfo
	for _, class := range findMainClasses(unitRoot) {
		found = append(found, MainClassInfo{Class: class.Class, File: classFile(class), Spring: class.Spring, Source: MainSourceScan})
	}
	return found
}

func classFile(class mainClass) string {
	relative := filepath.Join("src", "main", "java", filepath.FromSlash(strings.ReplaceAll(class.Class, ".", "/"))+".java")
	return filepath.ToSlash(filepath.Join(class.Module, relative))
}
