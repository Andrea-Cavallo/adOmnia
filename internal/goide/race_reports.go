package goide

import "adomnia/internal/languages/golang"

const raceReportStart = "WARNING: DATA RACE"
const raceReportSeparator = "=================="

type raceCollector struct{ golang.RaceCollector }

func (c *raceCollector) consumeJSON(b []byte) { c.ConsumeJSON(b) }
func (c *raceCollector) consumeText(s string) { c.ConsumeText(s) }
func (c *raceCollector) reports() []string    { return c.Reports() }
