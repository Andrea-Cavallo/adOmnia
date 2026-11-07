package python

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// External Libraries di un progetto Python: i pacchetti installati nell'ambiente dell'unità, non solo
// quelli dichiarati. La lettura è statica (.venv/site-packages e metadati delle distribuzioni): nessun
// processo, nessun import, nessuna installazione.

// InstalledDistribution è una distribuzione presente in un site-packages.
type InstalledDistribution struct {
	// Name è il nome normalizzato PEP 503, lo stesso delle dipendenze dichiarate.
	Name string
	// Version è quella dichiarata nei metadati (METADATA/PKG-INFO).
	Version string
	// Directory è la cartella del pacchetto da sfogliare: il package top-level quando c'è,
	// altrimenti la cartella dei metadati.
	Directory string
	// SitePackages è la radice che la contiene.
	SitePackages string
}

// SitePackages trova le cartelle site-packages dell'ambiente dell'unità. Prima l'ambiente del progetto
// (.venv/venv/env), altrimenti il prefisso dell'interprete scelto: entrambe le letture sono solo stat.
func SitePackages(unitRoot, interpreter string) []string {
	prefix := ""
	if environment := environmentInterpreterDirectory(unitRoot); environment != "" {
		prefix = environment
	}
	if prefix == "" && interpreter != "" {
		prefix = interpreterPrefix(interpreter)
	}
	if prefix == "" {
		return nil
	}
	candidates := []string{
		filepath.Join(prefix, "Lib", "site-packages"),
		filepath.Join(prefix, "lib", "site-packages"),
		filepath.Join(prefix, "lib64", "site-packages"),
	}
	for _, pattern := range []string{
		filepath.Join(prefix, "lib", "python*", "site-packages"),
		filepath.Join(prefix, "lib", "python*", "dist-packages"),
		filepath.Join(prefix, "lib64", "python*", "site-packages"),
		filepath.Join(prefix, "local", "lib", "python*", "site-packages"),
		filepath.Join(prefix, "local", "lib", "python*", "dist-packages"),
	} {
		if matches, err := filepath.Glob(pattern); err == nil {
			candidates = append(candidates, matches...)
		}
	}
	sort.Strings(candidates)
	seen := []os.FileInfo{}
	sites := []string{}
	for _, candidate := range candidates {
		clean := filepath.Clean(candidate)
		info, err := os.Stat(clean)
		if err != nil || !info.IsDir() {
			continue
		}
		duplicate := false
		for _, known := range seen {
			if os.SameFile(known, info) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		seen = append(seen, info)
		sites = append(sites, clean)
	}
	return sites
}

// interpreterPrefix ricava il prefisso dell'interprete dal suo percorso: `<prefix>/bin/python`,
// `<prefix>\Scripts\python.exe` oppure `<prefix>\python.exe`.
func interpreterPrefix(interpreter string) string {
	directory := filepath.Dir(interpreter)
	switch strings.ToLower(filepath.Base(directory)) {
	case "bin", "scripts":
		return filepath.Dir(directory)
	}
	return directory
}

// InstalledDistributions elenca le distribuzioni dei site-packages, una per nome normalizzato. La prima
// cartella vince quando lo stesso pacchetto compare più volte (un ambiente per unità).
func InstalledDistributions(sitePackages []string) []InstalledDistribution {
	seen := map[string]bool{}
	distributions := []InstalledDistribution{}
	for _, site := range sitePackages {
		entries, err := os.ReadDir(site)
		if err != nil {
			continue
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			name := entry.Name()
			metadata := ""
			switch {
			case strings.HasSuffix(name, ".dist-info"):
				metadata = filepath.Join(site, name, "METADATA")
			case strings.HasSuffix(name, ".egg-info"):
				metadata = filepath.Join(site, name, "PKG-INFO")
			default:
				continue
			}
			packageName, version, ok := distributionMetadata(metadata)
			if !ok {
				continue
			}
			key := normalizeDependencyName(packageName)
			if key == "" || seen[key] {
				continue
			}
			directory := packageDirectory(site, filepath.Join(site, name), packageName)
			if directory == "" {
				directory = filepath.Join(site, name)
			}
			seen[key] = true
			distributions = append(distributions, InstalledDistribution{Name: key, Version: version, Directory: directory, SitePackages: site})
		}
	}
	sort.SliceStable(distributions, func(i, j int) bool { return distributions[i].Name < distributions[j].Name })
	return distributions
}

// distributionMetadata legge Name e Version dalle intestazioni di METADATA/PKG-INFO.
func distributionMetadata(path string) (name, version string, ok bool) {
	data, err := readLimited(path, maxManifestBytes)
	if err != nil {
		return "", "", false
	}
	for raw := range strings.SplitSeq(string(data), "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			break
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "name":
			name = strings.TrimSpace(value)
		case "version":
			version = strings.TrimSpace(value)
		}
	}
	return name, version, name != "" && version != ""
}

// packageDirectory è la cartella del package top-level di una distribuzione: top_level.txt quando c'è,
// altrimenti il nome della distribuzione e le sue varianti con `_`.
func packageDirectory(site, metadataDirectory, distributionName string) string {
	var candidates []string
	if data, err := readLimited(filepath.Join(metadataDirectory, "top_level.txt"), maxManifestBytes); err == nil {
		for line := range strings.SplitSeq(string(data), "\n") {
			if value := strings.TrimSpace(line); value != "" && !strings.ContainsAny(value, `/\`) {
				candidates = append(candidates, value)
			}
		}
	}
	base := filepath.Base(metadataDirectory)
	base = strings.TrimSuffix(strings.TrimSuffix(base, ".dist-info"), ".egg-info")
	base = strings.SplitN(base, "-", 2)[0]
	normalized := strings.ReplaceAll(normalizeDependencyName(distributionName), "-", "_")
	candidates = append(candidates, base, normalized, strings.ReplaceAll(strings.TrimSpace(distributionName), "-", "_"))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || strings.HasPrefix(candidate, ".") || seen[candidate] {
			continue
		}
		seen[candidate] = true
		directory := filepath.Join(site, candidate)
		if isDirectory(directory) {
			return directory
		}
		if isFile(directory + ".py") {
			// Un modulo singolo non ha una cartella: si sfoglia il site-packages che lo contiene.
			return site
		}
	}
	return ""
}

// NormalizedDependencyName espone la normalizzazione PEP 503 all'host (chiavi della vista dipendenze).
func NormalizedDependencyName(name string) string { return normalizeDependencyName(name) }
