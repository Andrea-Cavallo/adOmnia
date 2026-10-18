package java

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// PrepareDebugBuild keeps JVM options out of cmd.exe's command text. Spring passes @file to Java (JDK 9+).
func PrepareDebugBuild(binary string, arguments []string) ([]string, func(), error) {
	cleanup := func() {}
	extension := strings.ToLower(filepath.Ext(binary))
	if extension != ".cmd" && extension != ".bat" {
		return arguments, cleanup, nil
	}
	const prefix = "-Dspring-boot.run.jvmArguments="
	out := slices.Clone(arguments)
	for i, argument := range out {
		if !strings.HasPrefix(argument, prefix) {
			continue
		}
		options, err := splitVMOptions(strings.TrimPrefix(argument, prefix))
		if err != nil {
			return nil, cleanup, err
		}
		file, err := os.CreateTemp("", "adomnia-java-debug-*.args")
		if err != nil {
			return nil, cleanup, err
		}
		cleanup = func() { _ = os.Remove(file.Name()) }
		var lines []string
		for _, option := range options {
			lines = append(lines, argFileQuote(option))
		}
		_, writeErr := file.WriteString(strings.Join(lines, "\n") + "\n")
		closeErr := file.Close()
		if writeErr != nil {
			cleanup()
			return nil, func() {}, writeErr
		}
		if closeErr != nil {
			cleanup()
			return nil, func() {}, closeErr
		}
		out[i] = prefix + "@" + file.Name()
	}
	return out, cleanup, nil
}

// Matches the quote-based option splitting used by the Spring Boot launcher; backslashes stay literal.
func splitVMOptions(text string) ([]string, error) {
	var options []string
	var token strings.Builder
	var quote rune
	started := false
	for _, r := range text {
		if r == '\r' || r == '\n' || r == 0 {
			return nil, fmt.Errorf("VM options must be on one line")
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				token.WriteRune(r)
			}
			started = true
			continue
		}
		if r == '\'' || r == '"' {
			quote = r
			started = true
			continue
		}
		if r == ' ' || r == '\t' {
			if started {
				options = append(options, token.String())
				token.Reset()
				started = false
			}
			continue
		}
		token.WriteRune(r)
		started = true
	}
	if quote != 0 {
		return nil, fmt.Errorf("unclosed quote in Java VM options")
	}
	if started {
		options = append(options, token.String())
	}
	return options, nil
}
