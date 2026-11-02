package codestudio

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/browser"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
)

// runPage opens the verification URL in a throwaway headless browser and records a
// screenshot, the page errors and the requests. A page that fails to load or reports
// a JavaScript error is a failed verification.
func (verifier *TaskVerifier) runPage(ctx context.Context, request agenttask.VerifyRequest) agenttask.Evidence {
	verification := request.Verification
	evidence := agenttask.Evidence{Outcome: agenttask.EvidenceError, Environment: "headless browser", Command: "GET " + verification.URL}
	parsed, err := url.Parse(verification.URL)
	if err != nil || parsed.Host == "" {
		evidence.Log = "invalid URL"
		return evidence
	}
	if !verification.AllowRemote && !agenttask.IsLoopbackHost(parsed.Hostname()) {
		evidence.Outcome = agenttask.EvidenceNotRun
		evidence.Log = fmt.Sprintf("%s is not a loopback host: approve remote hosts on the verification first.", parsed.Hostname())
		return evidence
	}
	return verifier.withServiceAndMock(ctx, request, parsed, evidence, func(base agenttask.Evidence) agenttask.Evidence {
		return verifier.capturePage(ctx, request, base)
	})
}

func (verifier *TaskVerifier) capturePage(ctx context.Context, request agenttask.VerifyRequest, evidence agenttask.Evidence) agenttask.Evidence {
	verification := request.Verification
	started := time.Now()
	capture, err := browser.CapturePage(ctx, verification.URL, time.Duration(max(1, verification.SettleSeconds))*time.Second)
	evidence.DurationMs = time.Since(started).Milliseconds()
	if err != nil {
		evidence.Outcome = agenttask.EvidenceError
		evidence.Log = "the page could not be captured: " + err.Error()
		return evidence
	}
	failed := failedRequests(capture.Requests)
	evidence.Observations = append(evidence.Observations,
		agenttask.Observation{Name: "title", Value: capture.Title},
		agenttask.Observation{Name: "jsErrors", Value: fmt.Sprintf("%d", len(capture.Errors))},
		agenttask.Observation{Name: "requests", Value: fmt.Sprintf("%d", len(capture.Requests))},
		agenttask.Observation{Name: "failedRequests", Value: fmt.Sprintf("%d", len(failed))},
	)
	if path, err := verifier.saveScreenshot(request.TaskID, capture.PNG); err == nil {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "screenshot", Value: path})
	} else {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "screenshot", Value: "not saved: " + err.Error()})
	}
	var log strings.Builder
	fmt.Fprintf(&log, "Page %q · %d requests · %d JavaScript errors\n", capture.Title, len(capture.Requests), len(capture.Errors))
	for _, message := range capture.Errors {
		fmt.Fprintf(&log, "\nJavaScript error:\n%s\n", message)
	}
	for _, line := range failed {
		fmt.Fprintf(&log, "\nFailed request: %s\n", line)
	}
	evidence.Log = log.String()
	status := documentStatus(capture.Requests, verification.URL)
	evidence.ExitCode = &status
	switch {
	case status == 0:
		evidence.Outcome = agenttask.EvidenceFailed
		evidence.Log = "the page did not answer\n" + evidence.Log
	case status >= 400 || len(capture.Errors) > 0:
		evidence.Outcome = agenttask.EvidenceFailed
	default:
		evidence.Outcome = agenttask.EvidencePassed
	}
	return evidence
}

func failedRequests(requests []browser.DebugNetworkEntry) []string {
	var failed []string
	for _, entry := range requests {
		if entry.Status >= 400 {
			failed = append(failed, fmt.Sprintf("%s %s → %d", entry.Method, entry.URL, entry.Status))
		}
	}
	return failed
}

// documentStatus is the HTTP status of the page itself (0 when it never answered).
func documentStatus(requests []browser.DebugNetworkEntry, pageURL string) int {
	for _, entry := range requests {
		if strings.TrimRight(entry.URL, "/") == strings.TrimRight(pageURL, "/") && entry.Status > 0 {
			return entry.Status
		}
	}
	for _, entry := range requests {
		if strings.HasPrefix(entry.MimeType, "text/html") && entry.Status > 0 {
			return entry.Status
		}
	}
	return 0
}

// saveScreenshot keeps the PNG in the app data, outside the project: evidence is local
// and never written into the user's working tree.
func (verifier *TaskVerifier) saveScreenshot(taskID string, png []byte) (string, error) {
	if verifier.evidenceDir == "" {
		return "", fmt.Errorf("no evidence folder is configured")
	}
	dir := filepath.Join(verifier.evidenceDir, safeName(taskID))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, fmt.Sprintf("page-%d.png", time.Now().UnixNano()))
	if err := os.WriteFile(path, png, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// safeName keeps letters, digits, dash and underscore: a task ID never becomes a path.
func safeName(value string) string {
	return strings.Map(func(char rune) rune {
		switch {
		case char == '-' || char == '_', char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9':
			return char
		default:
			return '_'
		}
	}, value)
}
