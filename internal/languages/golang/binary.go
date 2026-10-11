package golang

import (
	"bufio"
	"debug/buildinfo"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// BinaryReport descrive un eseguibile Go: dimensione, metadati di build, moduli e cosa occupa spazio.
type BinaryReport struct {
	Path      string            `json:"path"`
	Size      int64             `json:"size"`
	GoVersion string            `json:"goVersion"`
	Main      string            `json:"main"`
	Modules   []BinaryModule    `json:"modules"`
	Settings  map[string]string `json:"settings"`
	Packages  []BinarySize      `json:"packages"`
	Symbols   []BinarySize      `json:"symbols"`
	// SymbolBytes è la somma delle dimensioni dei simboli (il resto sono header, sezioni, allineamento).
	SymbolBytes int64        `json:"symbolBytes"`
	Embedded    []BinarySize `json:"embedded"`
}

type BinaryModule struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Replace string `json:"replace,omitempty"`
}

type BinarySize struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// ReadBinaryInfo legge dimensione e metadati di build (debug/buildinfo, senza eseguire nulla).
func ReadBinaryInfo(path string) (BinaryReport, error) {
	info, err := os.Stat(path)
	if err != nil {
		return BinaryReport{}, err
	}
	build, err := buildinfo.ReadFile(path)
	if err != nil {
		return BinaryReport{}, err
	}
	report := BinaryReport{Path: path, Size: info.Size(), GoVersion: build.GoVersion, Main: build.Main.Path, Settings: map[string]string{}, Modules: []BinaryModule{}}
	for _, setting := range build.Settings {
		report.Settings[setting.Key] = setting.Value
	}
	for _, dependency := range build.Deps {
		module := BinaryModule{Path: dependency.Path, Version: dependency.Version}
		if dependency.Replace != nil {
			module.Replace = dependency.Replace.Path + " " + dependency.Replace.Version
		}
		report.Modules = append(report.Modules, module)
	}
	return report, nil
}

// symbolPackage: "example.com/x/pkg.(*T).M" → "example.com/x/pkg"; "type:*", "go:buildid" → "(runtime data)".
func symbolPackage(name string) string {
	if strings.HasPrefix(name, "type:") || strings.HasPrefix(name, "go:") || !strings.Contains(name, ".") {
		return "(runtime data)"
	}
	slash := strings.LastIndex(name, "/")
	if dot := strings.Index(name[slash+1:], "."); dot >= 0 {
		return name[:slash+1+dot]
	}
	return name
}

type nmSymbol struct {
	address uint64
	size    int64
	name    string
}

// sectionMarker: simboli che delimitano intere sezioni e coprono gli altri (si contano solo i byte scoperti).
func sectionMarker(name string) bool {
	switch name {
	case "runtime.rodata", "runtime.types", "runtime.text", "runtime.data", "runtime.noptrdata", "runtime.bss", "runtime.noptrbss", "type:*", "go:func.*":
		return true
	}
	return false
}

// ParseNM legge l'output di `go tool nm -size` e somma le dimensioni per package. I simboli si
// sovrappongono (marcatori di sezione, alias): ogni byte si conta una volta, troncando un simbolo
// all'inizio del successivo.
func ParseNM(output string, report *BinaryReport) {
	var symbols []nmSymbol
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 0, 1024*1024), 4*1024*1024)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 || fields[2] == "U" {
			continue
		}
		address, err := strconv.ParseUint(fields[0], 16, 64)
		size, sizeErr := strconv.ParseInt(fields[1], 10, 64)
		if err != nil || sizeErr != nil || size <= 0 {
			continue
		}
		symbols = append(symbols, nmSymbol{address: address, size: size, name: strings.Join(fields[3:], " ")})
	}
	// Allo stesso indirizzo vince il simbolo vero, non il marcatore; poi il più grande.
	sort.SliceStable(symbols, func(i, j int) bool {
		if symbols[i].address != symbols[j].address {
			return symbols[i].address < symbols[j].address
		}
		if sectionMarker(symbols[i].name) != sectionMarker(symbols[j].name) {
			return !sectionMarker(symbols[i].name)
		}
		return symbols[i].size > symbols[j].size
	})
	packages := map[string]int64{}
	var counted []BinarySize
	end := uint64(0)
	for index, symbol := range symbols {
		if index > 0 && symbol.address == symbols[index-1].address {
			continue
		}
		start := symbol.address
		if start < end {
			start = end // già coperto da un simbolo precedente
		}
		stop := symbol.address + uint64(symbol.size)
		for next := index + 1; next < len(symbols); next++ {
			if symbols[next].address > symbol.address {
				if symbols[next].address < stop {
					stop = symbols[next].address
				}
				break
			}
		}
		if stop <= start {
			continue
		}
		size := int64(stop - start)
		end = stop
		report.SymbolBytes += size
		packages[symbolPackage(symbol.name)] += size
		counted = append(counted, BinarySize{Name: symbol.name, Size: size})
	}
	sort.Slice(counted, func(i, j int) bool { return counted[i].Size > counted[j].Size })
	if len(counted) > 50 {
		counted = counted[:50]
	}
	report.Symbols = counted
	for name, size := range packages {
		report.Packages = append(report.Packages, BinarySize{Name: name, Size: size})
	}
	sort.Slice(report.Packages, func(i, j int) bool { return report.Packages[i].Size > report.Packages[j].Size })
}

var embedDirective = regexp.MustCompile(`^//go:embed\s+(.+)$`)

// EmbeddedFiles trova i file inclusi con //go:embed nei sorgenti di dir (pattern relativi al file).
func EmbeddedFiles(dir string) []BinarySize {
	seen := map[string]int64{}
	_ = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if name := entry.Name(); path != dir && (strings.HasPrefix(name, ".") || name == "vendor" || name == "node_modules" || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(data), "\n") {
			match := embedDirective.FindStringSubmatch(strings.TrimSpace(line))
			if match == nil {
				continue
			}
			for _, pattern := range strings.Fields(match[1]) {
				pattern = strings.TrimPrefix(strings.Trim(pattern, "\""), "all:")
				matches, _ := filepath.Glob(filepath.Join(filepath.Dir(path), filepath.FromSlash(pattern)))
				for _, file := range matches {
					_ = filepath.WalkDir(file, func(inner string, innerEntry os.DirEntry, err error) error {
						if err == nil && !innerEntry.IsDir() {
							if info, err := innerEntry.Info(); err == nil {
								rel, _ := filepath.Rel(dir, inner)
								seen[filepath.ToSlash(rel)] = info.Size()
							}
						}
						return nil
					})
				}
			}
		}
		return nil
	})
	out := make([]BinarySize, 0, len(seen))
	for name, size := range seen {
		out = append(out, BinarySize{Name: name, Size: size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Size > out[j].Size })
	return out
}
