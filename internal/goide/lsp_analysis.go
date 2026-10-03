package goide

import (
	"adomnia/internal/ide/language"
	"adomnia/internal/ide/lsp"
)

// classifyUsages assegna a ogni riferimento il tipo di utilizzo, chiedendolo al linguaggio del file
// (UsageClassifier) e leggendo ogni file una volta sola. Senza capability il riferimento resta senza tipo.
func classifyUsages(languages *language.Registry, locations []EditorLocation, textFor func(EditorLocation) string) {
	type fileUsages struct {
		classifier language.UsageClassifier
		indexes    []int
	}
	files := map[string]*fileUsages{}
	order := []string{}
	for index, location := range locations {
		path := location.Path
		if path == "" {
			path = pathFromURI(location.URI)
		}
		owner, _, ok := languages.ForPath(path)
		if !ok {
			continue
		}
		classifier, ok := owner.(language.UsageClassifier)
		if !ok {
			continue
		}
		file, seen := files[location.URI]
		if !seen {
			file = &fileUsages{classifier: classifier}
			files[location.URI] = file
			order = append(order, location.URI)
		}
		file.indexes = append(file.indexes, index)
	}
	for _, uri := range order {
		file := files[uri]
		positions := make([]lsp.Position, len(file.indexes))
		for slot, index := range file.indexes {
			positions[slot] = lspPosition(locations[index].Range.StartLine, locations[index].Range.StartColumn)
		}
		usages := file.classifier.ClassifyUsages(textFor(locations[file.indexes[0]]), positions)
		for slot, index := range file.indexes {
			if slot < len(usages) {
				locations[index].Usage = usages[slot]
			}
		}
	}
}

// declarationSource estrae la dichiarazione alla posizione tramite il linguaggio del file
// (DeclarationExtractor), limitata a maxQuickDefinitionLines righe.
func declarationSource(languages *language.Registry, path, text string, at EditorRange) (string, int, bool) {
	owner, _, ok := languages.ForPath(path)
	if !ok {
		return "", 0, false
	}
	extractor, ok := owner.(language.DeclarationExtractor)
	if !ok {
		return "", 0, false
	}
	code, startLine, found := extractor.DeclarationSource(text, lspPosition(at.StartLine, at.StartColumn))
	if !found {
		return "", 0, false
	}
	return clipLines(code, startLine)
}
