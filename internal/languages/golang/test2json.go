package golang

import (
	idetesting "adomnia/internal/ide/testing"
	"encoding/json"
	"regexp"
	"strings"
)

type Test2JSONParser struct{}

// testEvent è una riga di `go test -json` (test2json), inclusi gli eventi di build di Go 1.24+.
type testEvent struct {
	Action      string  `json:"Action"`
	Package     string  `json:"Package"`
	ImportPath  string  `json:"ImportPath"`
	Test        string  `json:"Test"`
	Elapsed     float64 `json:"Elapsed"`
	Output      string  `json:"Output"`
	FailedBuild string  `json:"FailedBuild"`
}

var (
	failureLine   = regexp.MustCompile(`^\s+([\w.\-/\\]+\.go):(\d+):`)
	buildLine     = regexp.MustCompile(`^([\w.\-/\\]+\.go):(\d+):\d+:`)
	shuffleLine   = regexp.MustCompile(`^-test\.shuffle (-?\d+)$`)
	benchmarkLine = regexp.MustCompile(`^\s*(?:Benchmark\S*\s+)?(\d+\s+.*\bns/op\b.*)$`)
)

func buildPackage(importPath string) string {
	if space := strings.Index(importPath, " "); space >= 0 {
		return importPath[:space]
	}
	return importPath
}
func atoiOrZero(value string) int {
	number := 0
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0
		}
		number = number*10 + int(digit-'0')
	}
	return number
}
func (Test2JSONParser) Parse(line []byte) (idetesting.Event, bool) {
	var raw testEvent
	if json.Unmarshal(line, &raw) != nil {
		return idetesting.Event{}, false
	}
	event := idetesting.Event{Action: raw.Action, Package: raw.Package, Test: raw.Test, Elapsed: raw.Elapsed, Output: raw.Output, FailedBuild: raw.FailedBuild}
	if raw.Action == "build-output" || raw.Action == "build-fail" {
		event.Package = buildPackage(raw.ImportPath)
	}
	text := strings.TrimRight(raw.Output, "\n")
	pattern := failureLine
	if raw.Action == "build-output" {
		pattern = buildLine
	}
	if match := pattern.FindStringSubmatch(text); match != nil {
		event.Failure = &idetesting.TestLocation{File: match[1], Line: atoiOrZero(match[2])}
	}
	if raw.Test == "" {
		if match := shuffleLine.FindStringSubmatch(text); match != nil {
			event.ShuffleSeed = match[1]
		}
	}
	if strings.HasPrefix(raw.Test, "Benchmark") {
		if match := benchmarkLine.FindStringSubmatch(text); match != nil {
			event.Benchmark = strings.Join(strings.Fields(match[1]), " ")
		}
	}
	event.TimedOut = strings.Contains(raw.Output, "test timed out after")
	return event, true
}
