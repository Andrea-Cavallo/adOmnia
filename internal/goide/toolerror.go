package goide

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	toolErrorMaxChars = 1500
	toolErrorHead     = 4
	toolErrorTail     = 8
)

var ansiSequence = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)`)

// cleanToolError rende l'output di uno strumento adatto a un messaggio d'errore per l'utente: senza codici ANSI,
// con le prime e le ultime righe (di solito la causa è in coda) e un tetto di caratteri.
func cleanToolError(output []byte, limit int) string {
	if limit <= 0 {
		limit = toolErrorMaxChars
	}
	text := strings.TrimSpace(ansiSequence.ReplaceAllString(strings.ReplaceAll(string(output), "\r\n", "\n"), ""))
	lines := strings.Split(text, "\n")
	if len(lines) > toolErrorHead+toolErrorTail+1 {
		omitted := len(lines) - toolErrorHead - toolErrorTail
		lines = append(append(append([]string{}, lines[:toolErrorHead]...), fmt.Sprintf("… %d lines omitted …", omitted)), lines[len(lines)-toolErrorTail:]...)
	}
	text = strings.Join(lines, "\n")
	if runes := []rune(text); len(runes) > limit {
		text = "…" + string(runes[len(runes)-limit:])
	}
	return text
}
