package goide

import (
	"errors"
	"sort"
	"strings"

	"adomnia/internal/languages/golang"
)

// MemoryModelReport: la sincronizzazione che la funzione sotto il cursore condivide con il suo package.
type MemoryModelReport struct {
	Function string             `json:"function"`
	Package  string             `json:"package"`
	Groups   []golang.SyncGroup `json:"groups"`
	Text     string             `json:"text"`
}

// MemoryModelAt trova la funzione che contiene relPath:line e spiega i suoi archi happens-before.
func (s *Service) MemoryModelAt(sessionID, relPath string, line int) (MemoryModelReport, error) {
	result, err := s.AnalyzeArchitecture(sessionID)
	if err != nil {
		return MemoryModelReport{}, err
	}
	file := strings.ReplaceAll(relPath, "\\", "/")
	// Inizi di funzione nel file, per sapere fin dove arriva quella del cursore.
	var starts []int
	var start, end = 0, 1 << 30
	for _, function := range result.Report.Functions {
		if function.Site.Path == file {
			starts = append(starts, function.Site.Line)
		}
	}
	sort.Ints(starts)
	for _, at := range starts {
		if at <= line {
			start = at
		} else {
			end = at
			break
		}
	}
	report := MemoryModelReport{Groups: []golang.SyncGroup{}}
	for _, op := range result.Report.Syncs {
		if op.Site.Path == file && op.Site.Line >= start && op.Site.Line < end {
			report.Function, report.Package = op.Function, op.Package
			break
		}
	}
	if report.Function == "" {
		return report, errors.New("this function does not synchronize: no go statement, channel, mutex, WaitGroup, Once or atomic")
	}
	report.Groups = golang.MemoryModel(result.Report.Syncs, report.Package, report.Function)
	report.Text = golang.MemoryModelText(report.Function, report.Groups)
	return report, nil
}
