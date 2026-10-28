// Package idetest holds the TestMain shared by the Code Studio packages: the test binary doubles as a fake
// gopls, and the tests run with an empty global git config. It is imported only by _test.go files.
package idetest

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// Main is the body of TestMain: it runs the fake gopls when FakeGoplsEnv is set, the tests otherwise.
func Main(m *testing.M) {
	if os.Getenv(ManagedHelperEnv) == "1" {
		// A long-lived child for the process-tree and orphan-sweep tests: they kill it, or it ends by itself.
		time.Sleep(5 * time.Minute)
		return
	}
	if os.Getenv(FakeGoplsEnv) != "" {
		runFakeGopls()
		return
	}
	os.Exit(runIsolatedFromUserGit(m))
}

// ManagedHelperEnv makes the test binary sleep as a child process to kill (see Main).
const ManagedHelperEnv = "ADOMNIA_GOIDE_MANAGED_HELPER"

// FakeGoplsEnv makes the test binary act as a fake gopls (see Main).
const FakeGoplsEnv = "ADOMNIA_FAKE_GOPLS"

// runIsolatedFromUserGit runs the tests with an empty global and system git config: hooks, signing or
// fsmonitor set up by the developer must not slow down or change the many tests that commit (a global
// core.hooksPath once cost 60 s per commit). The identity lives in that config, so repo-level settings win.
func runIsolatedFromUserGit(m *testing.M) int {
	dir, err := os.MkdirTemp("", "adomnia-ide-git-*")
	if err != nil {
		return m.Run()
	}
	defer os.RemoveAll(dir)
	config := filepath.Join(dir, "gitconfig")
	if err := os.WriteFile(config, []byte("[user]\n\tname = adOmnia tests\n\temail = tests@adomnia.invalid\n"), 0o600); err == nil {
		for _, variable := range []string{"GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"} {
			if err := os.Setenv(variable, config); err != nil {
				fmt.Fprintln(os.Stderr, "idetest: git config not isolated:", err)
			}
		}
		if err := os.Setenv("GIT_TERMINAL_PROMPT", "0"); err != nil {
			fmt.Fprintln(os.Stderr, "idetest: git prompts not disabled:", err)
		}
	}
	return m.Run()
}

// fakeGopls risponde lentamente a initialize e segnala su stderr ogni documento ricevuto prima di
// initialized: è la condizione che fa rispondere al vero gopls "addView called before server initialized".
type fakeGopls struct {
	initialized atomic.Bool
}

func (f *fakeGopls) HandleNotification(method string, params jsonv1.RawMessage) {
	switch method {
	case "initialized":
		f.initialized.Store(true)
	case "textDocument/didOpen", "textDocument/didChange", "textDocument/didSave", "textDocument/didClose":
		if !f.initialized.Load() {
			fmt.Fprintln(os.Stderr, "VIOLATION "+method+" before initialized")
		} else if method == "textDocument/didOpen" {
			var opened struct {
				TextDocument struct {
					URI     string `json:"uri"`
					Text    string `json:"text"`
					Version int    `json:"version"`
				} `json:"textDocument"`
			}
			_ = json.Unmarshal(params, &opened)
			fmt.Fprintln(os.Stderr, "OPENED "+opened.TextDocument.URI)
			if os.Getenv("ADOMNIA_FAKE_LSP_LOG_BUFFERS") != "" {
				fmt.Fprintf(os.Stderr, "BUFFER %d %s\n", opened.TextDocument.Version, opened.TextDocument.Text)
			}
		}
	}
}

func (f *fakeGopls) HandleRequest(_ context.Context, method string, _ jsonv1.RawMessage) (any, error) {
	if method == "initialize" {
		time.Sleep(400 * time.Millisecond)
		return map[string]any{"capabilities": map[string]any{}}, nil
	}
	if method == "workspace/symbol" {
		if os.Getenv("ADOMNIA_FAKE_LSP_SLOW") != "" {
			time.Sleep(time.Second)
		}
		return []lsp.SymbolInformation{{Name: "HealthySymbol", Kind: 12, Location: lsp.Location{URI: lsp.FileURI(os.Getenv("ADOMNIA_FAKE_LSP_ROOT") + "/main.go")}}}, nil
	}
	return nil, nil
}

func runFakeGopls() {
	fmt.Fprintln(os.Stderr, "ARGS "+strings.Join(os.Args[1:], " "))
	conn := lsp.NewConn(os.Stdin, os.Stdout, &fakeGopls{})
	conn.Run()
}
