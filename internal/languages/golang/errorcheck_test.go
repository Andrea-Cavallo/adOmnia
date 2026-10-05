package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

const errorFixture = `package store

import (
	"errors"
	"fmt"
	"os"
	"strconv"
)

var ErrNotFound = errors.New("not found")

type QueryError struct {
	Query string
	Err   error
}

func (e *QueryError) Error() string { return e.Query + ": " + e.Err.Error() }
func (e *QueryError) Unwrap() error { return e.Err }

func Ignored() {
	os.Remove("x")
}

func Discarded() {
	_ = os.Remove("x")
}

func Unhandled() error {
	_, err := strconv.Atoi("1")
	_, err = strconv.Atoi("2")
	return err
}

func Shadow() (err error) {
	if true {
		_, err := strconv.Atoi("1")
		if err != nil {
			return nil
		}
	}
	return err
}

func Verbs(err error) error {
	return fmt.Errorf("load: %v", err)
}

func Text(err error) error {
	return errors.New(err.Error())
}

func Compare(err error) bool {
	return err == ErrNotFound
}

func Assert(err error) string {
	if q, ok := err.(*QueryError); ok {
		return q.Query
	}
	return ""
}

func As(err error) bool {
	var target *QueryError
	return errors.As(err, target)
}

func AsOK(err error) bool {
	var target *QueryError
	return errors.As(err, &target)
}

func Lookup() (*QueryError, error) {
	return nil, nil
}

func Open(name string) error {
	_, err := os.Open(name)
	if err != nil {
		return err
	}
	return &QueryError{Query: name, Err: ErrNotFound}
}

func Explode() {
	panic("boom")
}

func Recovers() {
	defer func() { recover() }()
	go func() { _ = recover() }()
}

func Loop() error {
	var err error
	for err == nil {
		_, err = strconv.Atoi("1")
	}
	return err
}
`

func loadErrorFixture(t *testing.T) (ErrorReport, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/store\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "store.go")
	if err := os.WriteFile(source, []byte(errorFixture), 0o644); err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Tests: true, Fset: fset, Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 {
			t.Fatalf("fixture does not compile: %v", pkg.Errors)
		}
	}
	return AnalyzeErrorHandling(fset, loaded, os.ReadFile), errorFixture
}

func findingsByKind(report ErrorReport, source string) map[string][]string {
	result := map[string][]string{}
	for _, finding := range report.Findings {
		result[finding.Kind] = append(result[finding.Kind], finding.Function+":"+source[finding.Offset:finding.End])
	}
	for kind := range result {
		sort.Strings(result[kind])
	}
	return result
}

func TestAnalyzeErrorHandlingFindings(t *testing.T) {
	report, source := loadErrorFixture(t)
	got := findingsByKind(report, source)
	want := map[string][]string{
		"ignored":         {`Ignored:os.Remove("x")`},
		"discarded":       {"Discarded:_"},
		"unhandled":       {"Unhandled:err"},
		"shadow":          {"Shadow:err"},
		"wrap-verb":       {"Verbs:err"},
		"lost-chain":      {"Text:err.Error()"},
		"compare":         {"Compare:err == ErrNotFound"},
		"type-assert":     {"Assert:err.(*QueryError)"},
		"as-target":       {"As:target"},
		"nil-nil":         {"Lookup:return nil, nil"},
		"lost-context":    {"Loop:err", "Open:err", "Unhandled:err"},
		"panic":           {`Explode:panic("boom")`},
		"recover-swallow": {"Recovers.func:recover()"},
		"recover-noop":    {"Recovers.func:recover()"},
	}
	for kind, expected := range want {
		if strings.Join(got[kind], "|") != strings.Join(expected, "|") {
			t.Errorf("%s: got %q, want %q", kind, got[kind], expected)
		}
	}
	for kind := range got {
		if _, ok := want[kind]; !ok {
			t.Errorf("unexpected %s findings: %q", kind, got[kind])
		}
	}
}

func applyErrorFix(source string, fix *ErrorFix) string {
	edits := append([]ErrorEdit(nil), fix.Edits...)
	sort.Slice(edits, func(i, j int) bool { return edits[i].Offset > edits[j].Offset })
	for _, edit := range edits {
		source = source[:edit.Offset] + edit.Text + source[edit.End:]
	}
	return source
}

func TestAnalyzeErrorHandlingFixesAndCatalog(t *testing.T) {
	report, source := loadErrorFixture(t)
	fixes := map[string]string{}
	for _, finding := range report.Findings {
		if finding.Fix != nil {
			for _, edit := range finding.Fix.Edits {
				if edit.Original != source[edit.Offset:edit.End] {
					t.Fatalf("%s: stale original %q", finding.Kind, edit.Original)
				}
			}
			if _, seen := fixes[finding.Kind]; !seen || finding.Function == "Open" {
				fixes[finding.Kind] = applyErrorFix(source, finding.Fix)
			}
		}
	}
	if !strings.Contains(fixes["wrap-verb"], `fmt.Errorf("load: %w", err)`) {
		t.Errorf("wrap fix: %s", fixes["wrap-verb"])
	}
	if !strings.Contains(fixes["compare"], "return errors.Is(err, ErrNotFound)") {
		t.Errorf("compare fix missing")
	}
	if !strings.Contains(fixes["lost-context"], `return fmt.Errorf("open: %w", err)`) {
		t.Errorf("context fix missing")
	}

	if len(report.Sentinels) != 1 || report.Sentinels[0].Name != "ErrNotFound" || report.Sentinels[0].Message != "not found" {
		t.Fatalf("sentinels: %+v", report.Sentinels)
	}
	roles := map[string]int{}
	for _, ref := range report.Sentinels[0].Refs {
		roles[ref.Kind]++
	}
	if roles["compare"] != 1 || roles["wrap"] != 1 {
		t.Errorf("sentinel refs: %+v", report.Sentinels[0].Refs)
	}
	if len(report.Types) != 1 || !report.Types[0].Pointer || !report.Types[0].Unwrap || len(report.Types[0].Wraps) != 1 {
		t.Fatalf("types: %+v", report.Types)
	}
	kinds := map[string]bool{}
	for _, ref := range report.Types[0].Refs {
		kinds[ref.Kind] = true
	}
	if !kinds["new"] || !kinds["as"] {
		t.Errorf("type refs: %+v", report.Types[0].Refs)
	}

	paths := map[string][]string{}
	for _, path := range report.Paths {
		for _, ret := range path.Returns {
			paths[path.Function] = append(paths[path.Function], ret.Kind+" "+ret.Detail)
		}
	}
	if got := strings.Join(paths["Open"], "|"); got != "propagate from os.Open|typed &QueryError{…}" {
		t.Errorf("Open paths: %s", got)
	}
	if got := strings.Join(paths["Verbs"], "|"); got != "new fmt.Errorf(…) without %w" {
		t.Errorf("Verbs paths: %s", got)
	}
}

func TestHumanizeName(t *testing.T) {
	for input, want := range map[string]string{"ReadFile": "read file", "Open": "open", "parseHTTPRequest": "parse http request", "Atoi": "atoi"} {
		if got := humanizeName(input); got != want {
			t.Errorf("%s: %q", input, got)
		}
	}
}
