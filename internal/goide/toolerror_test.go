package goide

import (
	"strings"
	"testing"
)

func TestCleanToolError(t *testing.T) {
	if got := cleanToolError([]byte("\x1b[31mfatal:\x1b[0m bad\r\n"), 0); got != "fatal: bad" {
		t.Errorf("ansi and whitespace: %q", got)
	}
	var many strings.Builder
	for i := 1; i <= 40; i++ {
		many.WriteString("line ")
		many.WriteString(string(rune('A' + i%26)))
		many.WriteString("\n")
	}
	got := cleanToolError([]byte(many.String()), 0)
	if !strings.Contains(got, "28 lines omitted") || strings.Count(got, "\n") != toolErrorHead+toolErrorTail {
		t.Errorf("long output not summarised:\n%s", got)
	}
	long := cleanToolError([]byte(strings.Repeat("x", 5000)+"END"), 100)
	if !strings.HasSuffix(long, "END") || len([]rune(long)) > 101 {
		t.Errorf("not capped from the tail: %d chars", len([]rune(long)))
	}
	if cleanToolError(nil, 0) != "" {
		t.Error("empty output must stay empty")
	}
}
