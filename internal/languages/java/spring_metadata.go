package java

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Limiti dello scan della repository Maven locale: senza freni è un lavoro da minuti.
const (
	maxSpringMetadataArtifacts = 20_000
	metadataCheckpointEvery    = 200
	maxMetadataJSONBytes       = 4 << 20
)

// Stato della cache dei metadata: dice se le proprietà note sono complete o ancora da costruire.
const (
	MetadataIdle    = "idle"
	MetadataReady   = "ready"
	MetadataPartial = "partial"
)

// metadataEntry è ciò che la cache ricorda di un jar già letto.
type metadataEntry struct {
	Size       int64           `json:"size"`
	ModTime    int64           `json:"modTime"`
	Properties []SpringProperty `json:"properties"`
}

// springMetadataCache è il file di cache: un jar già letto non viene mai riaperto.
type springMetadataCache struct {
	Repository string                   `json:"repository"`
	Entries    map[string]metadataEntry `json:"entries"`
}

// osCacheDir è la cache utente: separato per i test.
var osCacheDir = os.UserCacheDir

var (
	metadataOnce  sync.Once
	metadataLock  sync.Mutex
	metadataIndex []SpringProperty
	metadataState = MetadataIdle
)

// springMetadataCacheFile è dove vive la cache dei metadata Spring.
func springMetadataCacheFile() string {
	root, err := osCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(root, "adomnia", "spring-configuration-metadata.json")
}

// loadMetadataProperties carica le proprietà note dagli jar già indicizzati. Non tocca il filesystem
// oltre la cache: è ciò che alimenta il completamento senza aprire mille zip.
func loadMetadataProperties() []SpringProperty {
	metadataOnce.Do(func() {
		cache := readMetadataCache()
		seen := map[string]bool{}
		for _, entry := range cache.Entries {
			for _, property := range entry.Properties {
				if !seen[property.Name] {
					seen[property.Name] = true
					metadataIndex = append(metadataIndex, property)
				}
			}
		}
		if len(metadataIndex) > 0 {
			metadataState = MetadataReady
		}
	})
	metadataLock.Lock()
	defer metadataLock.Unlock()
	return metadataIndex
}

func metadataStateOf() string {
	metadataLock.Lock()
	defer metadataLock.Unlock()
	return metadataState
}

func setMetadataState(state string) {
	metadataLock.Lock()
	defer metadataLock.Unlock()
	metadataState = state
}

func readMetadataCache() springMetadataCache {
	cache := springMetadataCache{Entries: map[string]metadataEntry{}}
	path := springMetadataCacheFile()
	if path == "" {
		return cache
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cache
	}
	if err := json.Unmarshal(data, &cache); err != nil || cache.Entries == nil {
		return springMetadataCache{Entries: map[string]metadataEntry{}}
	}
	return cache
}

func writeMetadataCache(cache springMetadataCache) {
	path := springMetadataCacheFile()
	if path == "" {
		return
	}
	data, err := json.Marshal(cache)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, data, 0o644)
}

// SpringMetadataReport è l'esito dello scan della repository Maven locale.
type SpringMetadataReport struct {
	// Artifacts è il numero di jar esaminati, Cached quelli già in cache.
	Artifacts int `json:"artifacts"`
	Cached    int `json:"cached"`
	// Properties è il numero di proprietà note aggiunte alla cache.
	Properties int `json:"properties"`
	// State è "ready" (completo) o "partial" (fermato al limite).
	State string `json:"state"`
	// Repository è la cartella scansionata.
	Repository string `json:"repository"`
}

// DefaultSpringRepository è la repository Maven locale dell'utente.
func DefaultSpringRepository() string {
	home, err := osHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".m2", "repository")
}

// RefreshSpringMetadata indicizza `META-INF/spring-configuration-metadata.json` degli jar della
// repository Maven locale. Nessuna rete: legge solo file già scaricati. Riprende dalla cache, quindi
// le scansioni successive toccano solo i jar nuovi o cambiati.
func RefreshSpringMetadata(repository string, limit int) SpringMetadataReport {
	report := SpringMetadataReport{Repository: repository, State: MetadataReady}
	if repository == "" {
		repository = DefaultSpringRepository()
		report.Repository = repository
	}
	if repository == "" {
		report.State = MetadataIdle
		return report
	}
	if limit <= 0 || limit > maxSpringMetadataArtifacts {
		limit = maxSpringMetadataArtifacts
	}
	setMetadataState(MetadataIdle)
	cache := readMetadataCache()
	if cache.Repository != repository {
		cache = springMetadataCache{Repository: repository, Entries: map[string]metadataEntry{}}
	}
	if cache.Entries == nil {
		cache.Entries = map[string]metadataEntry{}
	}

	candidates := metadataCandidates(repository)
	truncated := len(candidates) > limit
	if truncated {
		candidates = candidates[:limit]
	}
	saved := false
	for _, path := range candidates {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		report.Artifacts++
		if entry, ok := cache.Entries[path]; ok && entry.Size == info.Size() && entry.ModTime == info.ModTime().Unix() {
			report.Cached++
			continue
		}
		properties := readJarProperties(path)
		cache.Entries[path] = metadataEntry{Size: info.Size(), ModTime: info.ModTime().Unix(), Properties: properties}
		report.Properties += len(properties)
		if report.Artifacts%metadataCheckpointEvery == 0 {
			writeMetadataCache(cache)
			saved = true
		}
	}
	writeMetadataCache(cache)
	saved = saved || len(candidates) > 0
	if truncated {
		report.State = MetadataPartial
	}
	setMetadataState(report.State)
	metadataOnce = sync.Once{}
	metadataLock.Lock()
	metadataIndex = nil
	metadataLock.Unlock()
	_ = saved
	return report
}

// metadataCandidates elenca i jar della repository, prima quelli che quasi certamente hanno i
// metadata di Spring (starter, autoconfigure) e poi il resto.
func metadataCandidates(repository string) []string {
	var first, other []string
	_ = filepath.WalkDir(repository, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != repository && strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(entry.Name()), ".jar") {
			return nil
		}
		lower := strings.ToLower(path)
		if strings.Contains(lower, "spring") || strings.Contains(lower, "autoconfigure") || strings.Contains(lower, "starter") {
			first = append(first, path)
		} else {
			other = append(other, path)
		}
		return nil
	})
	sort.Strings(first)
	sort.Strings(other)
	return append(first, other...)
}

// readJarProperties legge i metadata di configurazione dentro un jar. Un jar corrotto o senza
// metadata non è un errore: semplicemente non contribuisce proprietà.
func readJarProperties(path string) []SpringProperty {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return nil
	}
	defer reader.Close()
	for _, file := range reader.File {
		if !strings.EqualFold(file.Name, "META-INF/spring-configuration-metadata.json") {
			continue
		}
		if file.UncompressedSize64 > maxMetadataJSONBytes {
			return nil
		}
		properties, ok := parseMetadataJSON(readZipEntry(file))
		if ok {
			return properties
		}
		return nil
	}
	return nil
}

func readZipEntry(file *zip.File) []byte {
	reader, err := file.Open()
	if err != nil {
		return nil
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxMetadataJSONBytes))
	if err != nil {
		return nil
	}
	return data
}

// parseMetadataJSON legge il formato `spring-configuration-metadata.json`.
func parseMetadataJSON(data []byte) ([]SpringProperty, bool) {
	if len(data) == 0 {
		return nil, false
	}
	var document struct {
		Properties []struct {
			Name         string          `json:"name"`
			Type         string          `json:"type"`
			Description  string          `json:"description"`
			SourceType   string          `json:"sourceType"`
			DefaultValue json.RawMessage `json:"defaultValue"`
			Deprecated   json.RawMessage `json:"deprecated"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, false
	}
	var properties []SpringProperty
	for _, item := range document.Properties {
		if item.Name == "" {
			continue
		}
		properties = append(properties, SpringProperty{
			Name: item.Name, Type: item.Type, Description: item.Description,
			Default: jsonScalar(item.DefaultValue), Deprecated: len(item.Deprecated) > 0 && string(item.Deprecated) != "null" && string(item.Deprecated) != "false",
			Source: SourceMetadata, Origin: item.SourceType,
		})
	}
	return properties, len(properties) > 0
}

// jsonScalar è il valore di default come testo, senza le virgolette JSON.
func jsonScalar(raw json.RawMessage) string {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "null" {
		return ""
	}
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		var decoded string
		if err := json.Unmarshal(raw, &decoded); err == nil {
			return decoded
		}
	}
	return value
}

// metadataFreshFor è il timestamp dell'ultima scansione utile (per mostrare "aggiornato alle …").
func metadataFreshFor() time.Time {
	info, err := os.Stat(springMetadataCacheFile())
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}
