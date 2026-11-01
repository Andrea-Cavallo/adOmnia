package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/startupperf"
)

// Fixture di apertura progetto (checklist performance, FASE 0): un monorepo Go + web con il numero di file
// sorgente richiesto, più rumore in node_modules e vendor pari al 20% che le esclusioni devono saltare.
// ponytail: generata in TempDir a ogni run; un fixture su disco riusabile serve solo se la generazione pesa nel tempo di CI.
const benchFilesPerDir = 50

func writeOpenFixture(tb testing.TB, files int) string {
	tb.Helper()
	root := tb.TempDir()
	write := func(path, body string) {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			tb.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			tb.Fatal(err)
		}
	}
	modules := max(1, files/5000)
	work := "go 1.22\n\nuse (\n"
	for module := range modules {
		name := fmt.Sprintf("svc%03d", module)
		work += "\t./" + name + "\n"
		write(filepath.Join(root, name, "go.mod"), "module example.com/"+name+"\n\ngo 1.22\n")
	}
	write(filepath.Join(root, "go.work"), work+")\n")
	write(filepath.Join(root, "web", "package.json"), `{"name":"web","private":true}`)
	for index := range files {
		dir := index / benchFilesPerDir
		var path, body string
		if index%4 == 3 {
			path = filepath.Join(root, "web", "src", fmt.Sprintf("view%04d", dir), fmt.Sprintf("part%d.ts", index))
			body = fmt.Sprintf("export const part%d = %d\n", index, index)
		} else {
			module := fmt.Sprintf("svc%03d", dir%modules)
			path = filepath.Join(root, module, "internal", fmt.Sprintf("pkg%04d", dir), fmt.Sprintf("file%d.go", index))
			body = fmt.Sprintf("package pkg%04d\n\nfunc Handler%d() int { return %d }\n", dir, index, index)
		}
		write(path, body)
	}
	for index := range files / 10 {
		write(filepath.Join(root, "node_modules", fmt.Sprintf("dep%04d", index/benchFilesPerDir), fmt.Sprintf("i%d.js", index)), "module.exports = 1\n")
		write(filepath.Join(root, "vendor", fmt.Sprintf("v%04d", index/benchFilesPerDir), fmt.Sprintf("v%d.go", index)), "package v\n")
	}
	return root
}

// BenchmarkProjectOpen misura apertura (wall + CPU del processo) e prima/seconda query Quick Open
// su 5k e 50k file; ADOMNIA_BENCH_LARGE=1 aggiunge 200k. Lanciare con `task bench:open`.
func BenchmarkProjectOpen(b *testing.B) {
	sizes := []int{5_000, 50_000}
	if large, _ := strconv.ParseBool(os.Getenv("ADOMNIA_BENCH_LARGE")); large {
		sizes = append(sizes, 200_000)
	}
	for _, size := range sizes {
		b.Run(fmt.Sprintf("files_%d", size), func(b *testing.B) {
			root := writeOpenFixture(b, size)
			var openTotal, cpuTotal, firstTotal, warmTotal time.Duration
			var entries float64
			runs := 0
			for b.Loop() {
				service := NewService(&memoryStore{}, nil)
				// Come nell'app: l'apertura non aspetta oltre questa soglia la detection (TestMain la allunga).
				service.workspace.detectWait = productionDetectionWait
				cpu, started := startupperf.ProcessCPU(), time.Now()
				session, err := service.OpenProject(root)
				openTotal += time.Since(started)
				cpuTotal += startupperf.ProcessCPU() - cpu
				if err != nil {
					b.Fatal(err)
				}
				started = time.Now()
				if _, err := service.QuickOpen(string(session.ID), "handler", 50); err != nil {
					b.Fatal(err)
				}
				firstTotal += time.Since(started)
				started = time.Now()
				if _, err := service.QuickOpen(string(session.ID), "file42", 50); err != nil {
					b.Fatal(err)
				}
				warmTotal += time.Since(started)
				entries = service.GetWorkspaceLoadPerformance()["fileIndexEntries"]
				service.Shutdown()
				runs++
			}
			perRun := func(total time.Duration) float64 { return float64(total.Microseconds()) / 1000 / float64(runs) }
			b.ReportMetric(perRun(openTotal), "open-ms")
			b.ReportMetric(perRun(cpuTotal), "open-cpu-ms")
			b.ReportMetric(perRun(firstTotal), "quickopen-first-ms")
			b.ReportMetric(perRun(warmTotal), "quickopen-warm-ms")
			b.ReportMetric(entries, "indexed-files")
		})
	}
}

func TestOpenRecordsLoadMetrics(t *testing.T) {
	root := writeOpenFixture(t, 200)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.QuickOpen(string(session.ID), "file1", 10); err != nil {
		t.Fatal(err)
	}
	metrics := service.GetWorkspaceLoadPerformance()
	for _, key := range []string{"openProjectMs", "openProjectCpuMs", "detectUnitsMs", "fileIndexBuildMs", "quickOpenMs"} {
		if _, ok := metrics[key]; !ok {
			t.Errorf("metrica %s assente: %v", key, metrics)
		}
	}
	// 150 sorgenti Go + 50 TS + 3 manifest; node_modules e vendor esclusi.
	if got := metrics["fileIndexEntries"]; got != 203 {
		t.Errorf("fileIndexEntries = %v, attesi 203 (node_modules/vendor esclusi)", got)
	}
}

func TestReopenDoesNotDetectAgain(t *testing.T) {
	root := writeOpenFixture(t, 20)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	first, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("riapertura ha creato una nuova sessione: %s != %s", first.ID, second.ID)
	}
	if got := service.GetWorkspaceLoadPerformance()["detectUnitsCount"]; got != 1 {
		t.Fatalf("detectUnitsCount = %v, attesa 1 sola detection", got)
	}
}

func TestOpenAnswersBeforeSlowDetection(t *testing.T) {
	root := writeOpenFixture(t, 20)
	events := make(chan EventEnvelope, 16)
	service := NewService(&memoryStore{}, func(event EventEnvelope) {
		if event.Type == "session.opened" || event.Type == "session.updated" {
			events <- event
		}
	})
	t.Cleanup(service.Shutdown)
	service.workspace.detectWait = 0
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	// Se la detection ha battuto il timer la sessione torna già completa: va bene uguale.
	if len(session.Project.Units) != 0 {
		t.Skip("detection più veloce del timer a zero: percorso asincrono non esercitato")
	}
	opened := <-events
	if opened.Type != "session.opened" {
		t.Fatalf("primo evento %s, atteso session.opened", opened.Type)
	}
	var updated EventEnvelope
	select {
	case updated = <-events:
	case <-time.After(10 * time.Second):
		t.Fatal("session.updated non arrivato dopo la detection")
	}
	if updated.Type != "session.updated" {
		t.Fatalf("secondo evento %s, atteso session.updated", updated.Type)
	}
	current, err := service.workspace.GetSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Project.Units) == 0 {
		t.Fatal("unità non salvate nella sessione dopo la detection")
	}
}

func TestCloseCancelsDetection(t *testing.T) {
	root := writeOpenFixture(t, 20)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	service.workspace.detectWait = 0
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.CloseSession(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	service.workspace.mu.RLock()
	pending := len(service.workspace.detections)
	service.workspace.mu.RUnlock()
	if pending != 0 {
		t.Fatalf("%d detection ancora registrate dopo la chiusura", pending)
	}
}
