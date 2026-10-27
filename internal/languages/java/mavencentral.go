package java

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// mavenCentralBase è l'indice pubblico delle versioni. Si interroga solo su richiesta dell'utente e solo
// con group:artifact: nessun file né nome di progetto lascia la macchina.
var mavenCentralBase = "https://repo1.maven.org/maven2"

const (
	metadataTimeout  = 8 * time.Second
	metadataLifetime = 30 * time.Minute
	metadataMaxBytes = 8 << 20
)

// VersionInfo dice a che punto è una dipendenza rispetto alle versioni stabili pubblicate.
type VersionInfo struct {
	Key     string `json:"key"`
	Current string `json:"current"`
	// Latest è l'ultima versione stabile (niente alpha, beta, milestone, RC, snapshot).
	Latest string `json:"latest"`
	// SameMajor è l'ultima stabile con lo stesso major di Current: l'aggiornamento a basso rischio.
	SameMajor string `json:"sameMajor,omitempty"`
	// Newer è true se esiste una versione stabile successiva a Current.
	Newer bool   `json:"newer"`
	Error string `json:"error,omitempty"`
}

type mavenMetadata struct {
	Versioning struct {
		Release  string   `xml:"release"`
		Versions []string `xml:"versions>version"`
	} `xml:"versioning"`
}

var (
	metadataClient = &http.Client{Timeout: metadataTimeout}
	metadataMu     sync.Mutex
	metadataCache  = map[string]cachedVersions{}
	unstableRE     = regexp.MustCompile(`(?i)(^|[.\-_])(alpha|beta|rc|cr|m|milestone|preview|pre|dev|snapshot|ea|b)[.\-_]?\d*($|[.\-_])`)
)

type cachedVersions struct {
	versions []string
	at       time.Time
}

// LookupVersions interroga Maven Central per ogni coordinata (key = `group:artifact`, valore = versione corrente).
// Un errore su una coordinata resta in quella riga: le altre proseguono.
func LookupVersions(ctx context.Context, current map[string]string) []VersionInfo {
	result := make([]VersionInfo, 0, len(current))
	for key, version := range current {
		versions, err := centralVersions(ctx, key)
		info := VersionInfo{Key: key, Current: version}
		if err != nil {
			info.Error = err.Error()
		} else {
			info = describeVersions(key, version, versions)
		}
		result = append(result, info)
	}
	return result
}

func describeVersions(key, current string, versions []string) VersionInfo {
	info := VersionInfo{Key: key, Current: current}
	stable := make([]string, 0, len(versions))
	for _, version := range versions {
		if !unstableRE.MatchString(version) {
			stable = append(stable, version)
		}
	}
	if len(stable) == 0 {
		return info
	}
	info.Latest = stable[len(stable)-1]
	for _, s := range slices.Backward(stable) {
		if majorOf(s) == majorOf(current) {
			info.SameMajor = s
			break
		}
	}
	position := indexOf(versions, current)
	if position < 0 {
		info.Newer = info.Latest != current
		return info
	}
	for _, version := range versions[position+1:] {
		if !unstableRE.MatchString(version) {
			info.Newer = true
			break
		}
	}
	return info
}

func majorOf(version string) string {
	return strings.FieldsFunc(version, func(r rune) bool { return r == '.' || r == '-' })[0:1][0]
}

func indexOf(values []string, value string) int {
	for index, candidate := range values {
		if candidate == value {
			return index
		}
	}
	return -1
}

func centralVersions(ctx context.Context, key string) ([]string, error) {
	group, artifact, ok := strings.Cut(key, ":")
	if !ok || group == "" || artifact == "" || strings.ContainsFunc(key, func(r rune) bool { return r <= ' ' || r == '/' || r == '?' || r == '#' || r == 92 }) {
		return nil, fmt.Errorf("invalid coordinate %q", key)
	}
	metadataMu.Lock()
	cached, hit := metadataCache[key]
	metadataMu.Unlock()
	if hit && time.Since(cached.at) < metadataLifetime {
		return cached.versions, nil
	}
	address := fmt.Sprintf("%s/%s/%s/maven-metadata.xml", mavenCentralBase, strings.ReplaceAll(group, ".", "/"), artifact)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	response, err := metadataClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Maven Central is not reachable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%s is not on Maven Central", key)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Maven Central answered %s", response.Status)
	}
	var metadata mavenMetadata
	if err := xml.NewDecoder(io.LimitReader(response.Body, metadataMaxBytes)).Decode(&metadata); err != nil {
		return nil, fmt.Errorf("unreadable metadata for %s: %w", key, err)
	}
	metadataMu.Lock()
	metadataCache[key] = cachedVersions{versions: metadata.Versioning.Versions, at: time.Now()}
	metadataMu.Unlock()
	return metadata.Versioning.Versions, nil
}
