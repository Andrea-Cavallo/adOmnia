package goide

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Monorepo sintetico: 40 moduli in go.work × 25 package × 4 file = 4000 file Go (~1 MB di sorgente),
// più node_modules e vendor da ignorare. I limiti sono larghi (macchine CI lente) ma intercettano
// regressioni di complessità: una scansione quadratica o non limitata li supera di molto.
const (
	scaleModules      = 40
	scalePackages     = 25
	scaleFilesPerPkg  = 4
	scaleOpenBudget   = 10 * time.Second
	scaleQueryBudget  = 3 * time.Second
	scaleSearchBudget = 10 * time.Second
)

func writeScaleMonorepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	var work strings.Builder
	work.WriteString("go 1.22\n\nuse (\n")
	for module := 0; module < scaleModules; module++ {
		name := fmt.Sprintf("svc%02d", module)
		work.WriteString("\t./" + name + "\n")
		if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name, "go.mod"), []byte("module example.com/"+name+"\n\ngo 1.22\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		for pkg := 0; pkg < scalePackages; pkg++ {
			directory := filepath.Join(root, name, "internal", fmt.Sprintf("pkg%02d", pkg))
			if err := os.MkdirAll(directory, 0o755); err != nil {
				t.Fatal(err)
			}
			for file := 0; file < scaleFilesPerPkg; file++ {
				body := fmt.Sprintf("package pkg%02d\n\n// Handler%d serve la richiesta.\nfunc Handler%d(value int) int {\n\treturn value * %d\n}\n", pkg, file, file, file+1)
				if module == scaleModules-1 && pkg == scalePackages-1 && file == 0 {
					body += "\nconst needleMarker = \"monorepo-needle\"\n"
				}
				if err := os.WriteFile(filepath.Join(directory, fmt.Sprintf("file%d.go", file)), []byte(body), 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	work.WriteString(")\n")
	if err := os.WriteFile(filepath.Join(root, "go.work"), []byte(work.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	// Rumore che non deve finire in Quick Open né nella ricerca.
	for index := 0; index < 500; index++ {
		directory := filepath.Join(root, "node_modules", fmt.Sprintf("dep%03d", index))
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "index.js"), []byte("// monorepo-needle\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestLargeMonorepoStaysResponsive(t *testing.T) {
	if testing.Short() {
		t.Skip("misura su monorepo grande saltata con -short")
	}
	root := writeScaleMonorepo(t)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)

	started := time.Now()
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	open := time.Since(started)
	if len(goLayoutOf(session.Project).Modules) != scaleModules {
		t.Fatalf("moduli del go.work: %d, attesi %d", len(goLayoutOf(session.Project).Modules), scaleModules)
	}

	started = time.Now()
	results, err := service.QuickOpen(string(session.ID), "svc39/internal/pkg24/file0", 20)
	quickOpen := time.Since(started)
	if err != nil || len(results) == 0 || !strings.HasSuffix(filepath.ToSlash(results[0].RelativePath), "svc39/internal/pkg24/file0.go") {
		t.Fatalf("Quick Open: %v %+v", err, results)
	}

	started = time.Now()
	search, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "monorepo-needle"})
	searchTime := time.Since(started)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range search.Matches {
		if strings.Contains(match.RelativePath, "node_modules") {
			t.Fatalf("node_modules non va cercato: %s", match.RelativePath)
		}
	}
	if len(search.Matches) != 1 {
		t.Fatalf("occorrenze trovate: %d, attesa 1 (%d file letti)", len(search.Matches), search.FilesScanned)
	}
	t.Logf("monorepo %d moduli, %d file Go: apertura %v, Quick Open %v, ricerca %v", scaleModules, scaleModules*scalePackages*scaleFilesPerPkg, open, quickOpen, searchTime)
	if open > scaleOpenBudget || quickOpen > scaleQueryBudget || searchTime > scaleSearchBudget {
		t.Fatalf("troppo lento: apertura %v (max %v), Quick Open %v (max %v), ricerca %v (max %v)", open, scaleOpenBudget, quickOpen, scaleQueryBudget, searchTime, scaleSearchBudget)
	}
}
