package golang

import (
	"strings"
	"testing"
)

var goroutineFixture = map[string]string{
	"go.mod":                         "module example.com/gor\n\ngo 1.22\n\nrequire golang.org/x/sync v0.0.0\n\nreplace golang.org/x/sync => ./third_party/sync\n",
	"third_party/sync/go.mod":        "module golang.org/x/sync\n\ngo 1.22\n",
	"third_party/sync/errgroup/e.go": "package errgroup\n\ntype Group struct{}\n\nfunc (g *Group) Go(f func() error)       {}\nfunc (g *Group) TryGo(f func() error) bool { return true }\nfunc (g *Group) SetLimit(n int)          {}\nfunc (g *Group) Wait() error             { return nil }\n",
	"cmd/main.go": `package main

import "example.com/gor/app"

func main() { app.Spawn() }
`,
	"app/app.go": `package app

import (
	"context"
	"net/http"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

type Server struct{}

func (s *Server) work() {}
func work(n int)        {}

func Spawn()                 { go work(1) }
func Literal()               { go func() { work(0) }() }
func Method(s *Server)       { go s.work() }
func Dynamic(f func())       { go f() }
func Timer() {
	time.AfterFunc(time.Second, func() {})
	context.AfterFunc(context.Background(), func() {})
}

func Group() {
	var g errgroup.Group
	g.SetLimit(4)
	for i := 0; i < 10; i++ {
		g.Go(func() error { return nil })
	}
	_ = g.Wait()
}

func Waited() {
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done() }()
	wg.Wait()
	wg.Go(func() {})
}

func Unbounded(items []int) {
	for _, item := range items {
		go work(item)
	}
}

func BoundedByConstant() {
	for i := 0; i < 3; i++ {
		go work(i)
	}
}

func Semaphore(items []int) {
	sem := make(chan struct{}, 2)
	for _, item := range items {
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			work(item)
		}()
	}
}

func Poller(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
		}
	}()
}

func Spinner() {
	go func() {
		for {
			work(1)
		}
	}()
}

func Handler(w http.ResponseWriter, r *http.Request) {
	go work(1)
	go func() {
		defer func() { _ = recover() }()
		work(2)
	}()
}

var Background = func() int { go work(1); return 1 }()
`,
}

var oldGoFixture = map[string]string{
	"go.mod": "module example.com/old\n\ngo 1.21\n",
	"old/old.go": `package old

func work(int) {}

func Capture(items []int) {
	for _, item := range items {
		go func() { work(item) }()
	}
}

func Passed(items []int) {
	for _, item := range items {
		go func(item int) { work(item) }(item)
	}
}
`,
}

func goroutinesOf(report ArchitectureReport, function string) []ArchGoroutine {
	var found []ArchGoroutine
	for _, g := range report.Goroutines {
		if g.Function == function {
			found = append(found, g)
		}
	}
	return found
}

func hasRisk(g ArchGoroutine, risk string) bool {
	for _, item := range g.Risks {
		if item == risk {
			return true
		}
	}
	return false
}

func TestCollectGoroutinesKindsAndShapes(t *testing.T) {
	report, _ := loadFixture(t, goroutineFixture)
	one := func(function string) ArchGoroutine {
		t.Helper()
		found := goroutinesOf(report, function)
		if len(found) != 1 {
			t.Fatalf("%s: want 1 goroutine, got %d", function, len(found))
		}
		return found[0]
	}
	cases := []struct{ function, kind, shape, launches string }{
		{"Spawn", "go", "named", "work"},
		{"Literal", "go", "literal", ""},
		{"(*Server).work", "", "", ""},
		{"Dynamic", "go", "dynamic", ""},
	}
	for _, tc := range cases {
		if tc.kind == "" {
			continue
		}
		g := one(tc.function)
		if g.Kind != tc.kind || g.Shape != tc.shape || g.Launches != tc.launches {
			t.Errorf("%s = %s/%s/%q, want %s/%s/%q", tc.function, g.Kind, g.Shape, g.Launches, tc.kind, tc.shape, tc.launches)
		}
	}
	if g := one("Method"); g.Shape != "method" || g.Launches != "Server.work" || g.LaunchesID == "" {
		t.Errorf("Method = %+v", g)
	}
	timers := goroutinesOf(report, "Timer")
	if len(timers) != 2 || timers[0].Kind != "afterfunc" || timers[0].Shape != "literal" {
		t.Errorf("Timer = %+v", timers)
	}
	if g := one("Group"); g.Kind != "errgroup" || !g.ErrGroup || !g.InLoop || !g.Bounded || len(g.Risks) != 0 {
		t.Errorf("Group = %+v", g)
	}
	waited := goroutinesOf(report, "Waited")
	if len(waited) != 2 || waited[0].Kind != "go" || !waited[0].WaitGroup || waited[1].Kind != "waitgroup-go" || len(waited[0].Risks) != 0 {
		t.Errorf("Waited = %+v", waited)
	}
	if background := goroutinesOf(report, "(package var)"); len(background) != 1 || background[0].Spawner != "" {
		t.Errorf("package var initializer = %+v", background)
	}
}

func TestGoroutineRiskRules(t *testing.T) {
	report, _ := loadFixture(t, goroutineFixture)
	risks := func(function string) ArchGoroutine {
		found := goroutinesOf(report, function)
		if len(found) == 0 {
			t.Fatalf("no goroutine in %s", function)
		}
		return found[0]
	}
	if g := risks("Unbounded"); !g.InLoop || g.LoopKind != "range" || g.Bounded || !hasRisk(g, "unbounded-loop-spawn") || g.Severity != "medium" {
		t.Errorf("Unbounded = %+v", g)
	}
	if g := risks("BoundedByConstant"); !g.Bounded || hasRisk(g, "unbounded-loop-spawn") {
		t.Errorf("BoundedByConstant = %+v", g)
	}
	if g := risks("Semaphore"); !g.Bounded || hasRisk(g, "unbounded-loop-spawn") || hasRisk(g, "no-wait") {
		t.Errorf("Semaphore = %+v", g)
	}
	if g := risks("Poller"); !g.Ctx || !g.Cancellable || hasRisk(g, "no-ctx-cancel") {
		t.Errorf("Poller = %+v", g)
	}
	if g := risks("Spinner"); !hasRisk(g, "no-ctx-cancel") || !hasRisk(g, "no-wait") {
		t.Errorf("Spinner = %+v", g)
	}
	if g := risks("Literal"); !hasRisk(g, "no-wait") || hasRisk(g, "fire-and-forget-in-handler") {
		t.Errorf("Literal = %+v", g)
	}
	handler := goroutinesOf(report, "Handler")
	if len(handler) != 2 {
		t.Fatalf("Handler goroutines = %d", len(handler))
	}
	if !hasRisk(handler[0], "fire-and-forget-in-handler") || !hasRisk(handler[0], "no-recover") || hasRisk(handler[0], "no-wait") {
		t.Errorf("Handler named = %+v", handler[0])
	}
	if !handler[1].Recover || hasRisk(handler[1], "no-recover") || !hasRisk(handler[1], "fire-and-forget-in-handler") {
		t.Errorf("Handler literal = %+v", handler[1])
	}
}

func TestGoroutineLoopVariableCaptureOnlyBeforeGo122(t *testing.T) {
	report, _ := loadFixture(t, oldGoFixture)
	if g := goroutinesOf(report, "Capture"); len(g) != 1 || !hasRisk(g[0], "loop-var-capture") || g[0].Severity != "high" {
		t.Errorf("Capture = %+v", g)
	}
	if g := goroutinesOf(report, "Passed"); len(g) != 1 || hasRisk(g[0], "loop-var-capture") {
		t.Errorf("Passed = %+v", g)
	}
	current, _ := loadFixture(t, map[string]string{"go.mod": "module example.com/new\n\ngo 1.22\n", "new/new.go": strings.ReplaceAll(oldGoFixture["old/old.go"], "package old", "package new")})
	if g := goroutinesOf(current, "Capture"); len(g) != 1 || hasRisk(g[0], "loop-var-capture") {
		t.Errorf("go 1.22 must not report loop-var-capture: %+v", g)
	}
}

func TestGoroutinesLinkToEntries(t *testing.T) {
	report, _ := loadFixture(t, goroutineFixture)
	spawn := goroutinesOf(report, "Spawn")
	if len(spawn) != 1 || len(spawn[0].Entries) != 1 || spawn[0].Entries[0] != "main example.com/gor/cmd" {
		t.Errorf("Spawn entries = %+v", spawn)
	}
	if report.Goroutines == nil {
		t.Error("goroutines must never be nil")
	}
}

func TestGoroutinesResolveMergeAndOrdering(t *testing.T) {
	first := ArchitectureReport{Goroutines: []ArchGoroutine{{Package: "b", Site: ArchSite{Path: "b.go", Offset: 9}}}}
	first.Merge(ArchitectureReport{Goroutines: []ArchGoroutine{{Package: "a", Site: ArchSite{Path: "a.go", Offset: 3}}}})
	if len(first.Goroutines) != 2 {
		t.Fatalf("Merge kept %d goroutines", len(first.Goroutines))
	}
	sortGoroutines(first.Goroutines)
	if first.Goroutines[0].Package != "a" {
		t.Errorf("not sorted by package: %+v", first.Goroutines)
	}
	first.Resolve(func(path string, offset int) (string, int, int) { return "rel/" + path, offset, 1 })
	if first.Goroutines[0].Site.Path != "rel/a.go" || first.Goroutines[0].Site.Line != 3 {
		t.Errorf("Resolve skipped goroutines: %+v", first.Goroutines[0].Site)
	}
}
