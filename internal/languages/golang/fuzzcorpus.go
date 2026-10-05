package golang

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Corpus del fuzzing nativo di Go: i file `go test fuzz v1` in testdata/fuzz/<FuzzX>/ (seed e
// input falliti, eseguiti da ogni `go test`) e quelli generati in $GOCACHE/fuzz/<import path>/<FuzzX>/.

const fuzzCorpusHeader = "go test fuzz v1"

var (
	fuzzTargetName = regexp.MustCompile(`^Fuzz[A-Za-z0-9_]*$`)
	fuzzTargetFunc = regexp.MustCompile(`^func\s+(Fuzz[A-Za-z0-9_]*)\s*\(\s*\w+\s+\*testing\.F\s*\)`)
)

// FuzzValue è un argomento di un input del corpus: il tipo e il letterale Go così come scritti da go test.
type FuzzValue struct {
	Type    string `json:"type"`
	Literal string `json:"literal"`
	// Expression è la riga originale, già un'espressione Go valida da usare in f.Add(...).
	Expression string `json:"expression"`
}

// ParseFuzzInput legge un file del corpus; un header diverso o una riga malformata sono un errore.
func ParseFuzzInput(data []byte) ([]FuzzValue, error) {
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != fuzzCorpusHeader {
		return nil, fmt.Errorf("not a Go fuzz corpus file (missing %q header)", fuzzCorpusHeader)
	}
	values := make([]FuzzValue, 0, len(lines)-1)
	for index, raw := range lines[1:] {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		open := strings.IndexByte(line, '(')
		if open <= 0 || !strings.HasSuffix(line, ")") {
			return nil, fmt.Errorf("line %d: expected type(value), got %q", index+2, line)
		}
		values = append(values, FuzzValue{Type: line[:open], Literal: line[open+1 : len(line)-1], Expression: line})
	}
	return values, nil
}

// ValidFuzzTargetName accetta solo nomi di funzione Fuzz*, mai percorsi.
func ValidFuzzTargetName(name string) bool { return fuzzTargetName.MatchString(name) }

// FuzzTargetDecl è una funzione FuzzX(f *testing.F) trovata in un file di test.
type FuzzTargetDecl struct {
	Name string
	Line int
}

// FuzzTargetsInFile elenca le funzioni fuzz dichiarate in un file _test.go.
func FuzzTargetsInFile(path string) []FuzzTargetDecl {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	var found []FuzzTargetDecl
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for line := 1; scanner.Scan(); line++ {
		if match := fuzzTargetFunc.FindStringSubmatch(scanner.Text()); match != nil {
			found = append(found, FuzzTargetDecl{Name: match[1], Line: line})
		}
	}
	return found
}

// GoBuildCache restituisce GOCACHE senza avviare `go env`: variabile d'ambiente o il default di Go.
func GoBuildCache(environment map[string]string) string {
	if value := strings.TrimSpace(environment["GOCACHE"]); value != "" && value != "off" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("GOCACHE")); value != "" && value != "off" {
		return value
	}
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "go-build")
}

// FuzzCacheDir è la cartella del corpus generato per un target; vuota se l'import path manca.
func FuzzCacheDir(cache, importPath, target string) string {
	if cache == "" || importPath == "" || !ValidFuzzTargetName(target) {
		return ""
	}
	return filepath.Join(cache, "fuzz", filepath.FromSlash(importPath), target)
}
