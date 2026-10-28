// Package airedact masks recognized secrets before text reaches an AI provider
// or a code-assistant language server.
//
// It mirrors the high-precision patterns of frontend/src/lib/aiRedaction.ts.
// The mask keeps the byte length, UTF-16 width and line breaks of the original
// text, so a language server still receives valid positions for completions
// while the secret itself never leaves the machine.
package airedact

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// secretPatterns are intentionally high precision: a false positive in source
// code changes the context of the model, so only unmistakable token shapes are
// masked here.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`),
	regexp.MustCompile(`eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]*`),
	regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b`),
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{36,}\b`),
	regexp.MustCompile(`\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b`),
	regexp.MustCompile(`\bsk-(?:proj-|ant-)?[A-Za-z0-9\-_]{20,}\b`),
	regexp.MustCompile(`\bxox[bprs]-[A-Za-z0-9-]{10,}\b`),
	regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
	regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{35}\b`),
}

// connectionPassword masks only the password part of a connection string, so
// the URL and the user stay readable.
var connectionPassword = regexp.MustCompile(`(?i)((?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis|rediss|amqps?|mssql|sqlserver)://[^:@\s/"'` + "`" + `]+:)([^@\s"'` + "`" + `]+)(@)`)

// sensitiveAssignment masks values assigned to a sensitive-looking name:
// password := "x", APIKey: "x", secret = `x`.
var sensitiveAssignment = regexp.MustCompile(`(?i)(\b[A-Za-z_0-9]*(?:password|passwd|secret|token|apikey|api_key|accesskey|access_key|privatekey|private_key|credential)[A-Za-z_0-9]*\b\s*(?::=|=|:)\s*)(["'` + "`" + `])([^"'` + "`" + `\n]{4,})(["'` + "`" + `])`)

// Redact replaces recognized secrets with masked characters. Byte length,
// UTF-16 width and line breaks are preserved, which keeps LSP positions valid,
// and the same input always produces the same output.
func Redact(text string) string {
	if text == "" {
		return ""
	}
	masked := []byte(text)

	// Group 3 of sensitiveAssignment is the quoted value and group 4 the closing
	// quote: Go's RE2 has no backreferences, so the quotes are compared here.
	for _, match := range sensitiveAssignment.FindAllStringSubmatchIndex(text, -1) {
		valueStart, valueEnd := match[6], match[7]
		openQuote, closeQuote := match[4], match[8]
		if valueStart < 0 || valueEnd <= valueStart || openQuote < 0 || closeQuote < 0 || text[openQuote] != text[closeQuote] {
			continue
		}
		maskRange(masked, valueStart, valueEnd)
	}
	for _, match := range connectionPassword.FindAllStringSubmatchIndex(text, -1) {
		maskRange(masked, match[4], match[5])
	}

	maskedText := string(masked)
	for _, pattern := range secretPatterns {
		maskedText = pattern.ReplaceAllStringFunc(maskedText, maskText)
	}
	return maskedText
}

// maskText replaces every rune with a mask of the same UTF-8 byte width and the
// same UTF-16 width, while CR and LF are preserved as line separators. The
// language server therefore sees the same positions for code after a secret.
func maskText(text string) string {
	var builder strings.Builder
	builder.Grow(len(text))
	for index := 0; index < len(text); {
		runeValue, size := utf8.DecodeRuneInString(text[index:])
		builder.WriteString(maskRune(runeValue))
		index += size
	}
	return builder.String()
}

func maskRange(data []byte, start, end int) {
	if start < 0 || end > len(data) || start >= end {
		return
	}
	for index := start; index < end; {
		runeValue, size := utf8.DecodeRune(data[index:end])
		replacement := maskRune(runeValue)
		if len(replacement) == size {
			copy(data[index:index+size], replacement)
		} else {
			for offset := range size {
				data[index+offset] = '*'
			}
		}
		index += size
	}
}

// maskRune keeps the byte width of the original rune (1, 2, 3 or 4 bytes) and
// its UTF-16 width: U+10348 is a surrogate pair like any non-BMP rune.
func maskRune(value rune) string {
	switch {
	case value == '\n' || value == '\r':
		return string(value)
	case value < 0x80:
		return "*"
	case value < 0x800:
		return "\u00a2"
	case value < 0x10000:
		return "\uff0a"
	default:
		return "\U00010348"
	}
}
