package java

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/ide/process"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/procutil"
)

// JDK descrive il JDK trovato. Un JDK mancante non è fatale: l'editor funziona, ma build e run no.
type JDK struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Home      string `json:"home,omitempty"`
	// Source è "JAVA_HOME" o "PATH".
	Source  string `json:"source,omitempty"`
	Version string `json:"version,omitempty"`
	// Major è la versione maggiore (8, 17, 21…); 0 se non leggibile.
	Major    int      `json:"major,omitempty"`
	Problem  string   `json:"problem,omitempty"`
	Remedies []string `json:"remedies,omitempty"`
}

const versionTimeout = 5 * time.Second

// lookPath e javaVersion sono sostituibili nei test.
var (
	lookPath    = exec.LookPath
	javaVersion = readJavaVersion
)

// DetectJDK cerca java in JAVA_HOME, poi nel PATH. Non esegue altro che `java -version`.
func DetectJDK() JDK {
	for _, candidate := range jdkCandidates() {
		version, err := javaVersion(candidate.binary)
		if err != nil {
			continue
		}
		return JDK{Available: true, Binary: candidate.binary, Home: candidate.home, Source: candidate.source, Version: version, Major: Major(version)}
	}
	return JDK{
		Problem: "Java (JDK) was not found on this machine",
		Remedies: []string{
			"Install a JDK, e.g. Eclipse Temurin 21 from https://adoptium.net (Windows: winget install EclipseAdoptium.Temurin.21.JDK)",
			"Or set JAVA_HOME to an existing JDK, then restart adOmnia so it sees the new environment",
		},
	}
}

type jdkCandidate struct{ binary, home, source string }

func jdkCandidates() []jdkCandidate {
	var candidates []jdkCandidate
	if home := strings.TrimSpace(os.Getenv("JAVA_HOME")); home != "" {
		candidates = append(candidates, jdkCandidate{binary: filepath.Join(home, "bin", sdk.ExecutableName("java")), home: home, source: "JAVA_HOME"})
	}
	if found, err := lookPath("java"); err == nil {
		candidates = append(candidates, jdkCandidate{binary: found, source: "PATH"})
	}
	return candidates
}

// versionLine riconosce `openjdk version "21.0.4" 2024-07-16` e `java version "1.8.0_402"`.
var versionLine = regexp.MustCompile(`version "([^"]+)"`)

func readJavaVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), versionTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, binary, "-version")
	process.Configure(command, false)
	// java -version scrive su stderr.
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s does not answer -version", binary)
	}
	if err != nil {
		return "", err
	}
	match := versionLine.FindSubmatch(output)
	if match == nil {
		return "", fmt.Errorf("unrecognized java -version output")
	}
	return string(match[1]), nil
}

// Major estrae la versione maggiore: "21.0.4" → 21, "1.8.0_402" → 8; 0 se non leggibile.
func Major(version string) int {
	first, rest, _ := strings.Cut(version, ".")
	if first == "1" {
		first, _, _ = strings.Cut(rest, ".")
	}
	first, _, _ = strings.Cut(first, "-")
	major, err := strconv.Atoi(first)
	if err != nil {
		return 0
	}
	return major
}
