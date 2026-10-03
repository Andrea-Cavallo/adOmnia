package golang

import (
	"encoding/json"
	"strings"
)

const (
	raceReportStart     = "WARNING: DATA RACE"
	raceReportSeparator = "=================="
	// maxRaceReports evita che un test con migliaia di race riempia la memoria dell'IDE.
	maxRaceReports    = 50
	maxRaceReportSize = 64 * 1024
)

// RaceCollector ricompone i report del race detector dall'output riga per riga di go test -json.
type RaceCollector struct {
	current   strings.Builder
	capturing bool
	collected []string
}

// ConsumeJSON legge il campo Output di un evento test2json; le righe non JSON sono ignorate.
func (c *RaceCollector) ConsumeJSON(line []byte) {
	if !c.capturing && !strings.Contains(string(line), "DATA RACE") {
		return
	}
	var event struct {
		Output string `json:"Output"`
	}
	if json.Unmarshal(line, &event) != nil || event.Output == "" {
		return
	}
	c.ConsumeText(event.Output)
}

// ConsumeText accumula testo grezzo: un report va da "WARNING: DATA RACE" alla riga di "=" successiva.
func (c *RaceCollector) ConsumeText(text string) {
	for _, line := range strings.SplitAfter(text, "\n") {
		if line == "" {
			continue
		}
		trimmed := strings.TrimSpace(line)
		if !c.capturing {
			if trimmed != raceReportStart {
				continue
			}
			c.capturing = true
			c.current.Reset()
		}
		if c.current.Len() < maxRaceReportSize {
			c.current.WriteString(line)
		}
		if trimmed == raceReportSeparator {
			c.finish()
		}
	}
}

func (c *RaceCollector) finish() {
	c.capturing = false
	if len(c.collected) < maxRaceReports {
		c.collected = append(c.collected, strings.TrimRight(c.current.String(), "\n"))
	}
	c.current.Reset()
}

func (c *RaceCollector) Reports() []string {
	if len(c.collected) == 0 {
		return nil
	}
	return append([]string(nil), c.collected...)
}
