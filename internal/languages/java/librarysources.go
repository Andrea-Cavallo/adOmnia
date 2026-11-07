package java

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Il jar dei sorgenti si estrae una volta in una cartella di cache: così l'albero e l'editor lo leggono
// come una cartella qualsiasi (sola lettura, come la module cache di Go). Solo testo, con limiti: un jar
// è un input non fidato.

const (
	maxSourceEntries    = 30000
	maxSourceFileBytes  = 4 << 20
	maxSourceTotalBytes = 256 << 20
	// sourcesReadyMarker c'è solo quando l'estrazione è finita: una cartella a metà non si usa.
	sourcesReadyMarker = ".adomnia-sources-ready"
)

// sourceExtensions sono i file utili da leggere in un jar di sorgenti.
var sourceExtensions = map[string]bool{
	".java": true, ".kt": true, ".scala": true, ".groovy": true, ".properties": true,
	".xml": true, ".json": true, ".yml": true, ".yaml": true, ".md": true, ".txt": true,
}

// SourcesDirectory è dove stanno i sorgenti estratti di una libreria, sotto la cache.
func SourcesDirectory(cacheRoot, groupID, artifactID, version string) string {
	return filepath.Join(cacheRoot, "maven-sources", groupID, artifactID, version)
}

// SourcesExtracted dice se i sorgenti di una libreria sono già pronti in cache.
func SourcesExtracted(directory string) bool {
	return isFile(filepath.Join(directory, sourcesReadyMarker))
}

// ExtractSources estrae il jar dei sorgenti in directory. Scrive in una cartella temporanea accanto e la
// rinomina alla fine, così un'estrazione interrotta non lascia una cartella che sembra completa.
func ExtractSources(sourcesJar, directory string) error {
	if SourcesExtracted(directory) {
		return nil
	}
	reader, err := zip.OpenReader(sourcesJar)
	if err != nil {
		return fmt.Errorf("cannot read the sources jar: %w", err)
	}
	defer func() { _ = reader.Close() }() // sola lettura: l'errore di Close non cambia nulla
	if len(reader.File) > maxSourceEntries {
		return fmt.Errorf("the sources jar has more than %d entries", maxSourceEntries)
	}
	if err := os.MkdirAll(filepath.Dir(directory), 0o755); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(filepath.Dir(directory), ".extract-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(staging) }() // dopo il rename non c'è più nulla da togliere
	var total int64
	for _, entry := range reader.File {
		written, err := extractSourceEntry(entry, staging, maxSourceTotalBytes-total)
		if err != nil {
			return err
		}
		total += written
	}
	if err := os.WriteFile(filepath.Join(staging, sourcesReadyMarker), nil, 0o644); err != nil {
		return err
	}
	_ = os.RemoveAll(directory) // un'estrazione precedente interrotta
	return os.Rename(staging, directory)
}

// extractSourceEntry scrive un file di testo del jar dentro root; salta il resto e rifiuta i percorsi che escono.
func extractSourceEntry(entry *zip.File, root string, budget int64) (int64, error) {
	// A name with ".." anywhere, absolute or with a drive letter never reaches the file system (Zip Slip).
	if strings.Contains(entry.Name, "..") || strings.Contains(entry.Name, ":") || path.IsAbs(strings.ReplaceAll(entry.Name, "\\", "/")) {
		return 0, fmt.Errorf("the sources jar contains an unsafe path: %s", entry.Name)
	}
	name := path.Clean(strings.ReplaceAll(entry.Name, "\\", "/"))
	if entry.FileInfo().IsDir() || !sourceExtensions[strings.ToLower(path.Ext(name))] || strings.HasPrefix(name, "META-INF/") {
		return 0, nil
	}
	if entry.UncompressedSize64 > maxSourceFileBytes {
		return 0, nil
	}
	if int64(entry.UncompressedSize64) > budget {
		return 0, errors.New("the sources jar is too large to extract")
	}
	target := filepath.Join(root, filepath.FromSlash(name))
	if !strings.HasPrefix(target, filepath.Clean(root)+string(os.PathSeparator)) {
		return 0, fmt.Errorf("the sources jar contains an unsafe path: %s", entry.Name)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, err
	}
	source, err := entry.Open()
	if err != nil {
		return 0, err
	}
	defer func() { _ = source.Close() }() // sola lettura
	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	written, copyErr := io.Copy(file, io.LimitReader(source, maxSourceFileBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return 0, copyErr
	}
	if closeErr != nil {
		return 0, closeErr
	}
	if written > maxSourceFileBytes {
		return 0, fmt.Errorf("%s is larger than declared in the jar", entry.Name)
	}
	return written, nil
}
