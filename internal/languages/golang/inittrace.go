package golang

import (
	"regexp"
	"sort"
	"strconv"
)

// InitStep è una funzione init di un package, misurata da GODEBUG=inittrace=1.
type InitStep struct {
	Package string  `json:"package"`
	AtMs    float64 `json:"atMs"`
	ClockMs float64 `json:"clockMs"`
	Bytes   int64   `json:"bytes"`
	Allocs  int64   `json:"allocs"`
}

// "init example.com/app/config @1.2 ms, 35 ms clock, 1024 bytes, 12 allocs"
var initTraceLine = regexp.MustCompile(`^init (\S+) @([\d.]+) ms, ([\d.]+) ms clock, (\d+) bytes, (\d+) allocs`)

// ParseInitTrace legge le righe di inittrace, dalle init più lente.
func ParseInitTrace(lines []string) []InitStep {
	var steps []InitStep
	for _, line := range lines {
		match := initTraceLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		at, _ := strconv.ParseFloat(match[2], 64)
		clock, _ := strconv.ParseFloat(match[3], 64)
		bytes, _ := strconv.ParseInt(match[4], 10, 64)
		allocs, _ := strconv.ParseInt(match[5], 10, 64)
		steps = append(steps, InitStep{Package: match[1], AtMs: at, ClockMs: clock, Bytes: bytes, Allocs: allocs})
	}
	sort.SliceStable(steps, func(i, j int) bool { return steps[i].ClockMs > steps[j].ClockMs })
	return steps
}
