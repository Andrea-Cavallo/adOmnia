package goide

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFirstProxyURL(t *testing.T) {
	cases := map[string]string{
		"":                                          "https://proxy.golang.org",
		"off":                                       "",
		"direct":                                    "",
		"https://art.corp/api/go/virtual/,direct":   "https://art.corp/api/go/virtual",
		"direct|http://nexus.local:8081/repository": "http://nexus.local:8081/repository",
	}
	for input, want := range cases {
		if got := firstProxyURL(input); got != want {
			t.Errorf("firstProxyURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCheckModuleRegistry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/github.com/!burnt!sushi/toml/@v/list":
			_, _ = w.Write([]byte("v1.0.0\nv1.1.0\n"))
		case "/git.corp.example/private/@v/list":
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	isolateGitCredentials(t)

	if check := checkModuleRegistry(server.URL, "github.com/BurntSushi/toml"); !check.OK || !strings.Contains(check.Message, "2 versioni") {
		t.Fatalf("expected two versions through the escaped path: %+v", check)
	}
	if check := checkModuleRegistry(server.URL, "git.corp.example/private"); check.OK || check.Status != http.StatusUnauthorized {
		t.Fatalf("expected a login request: %+v", check)
	}
	if check := checkModuleRegistry(server.URL, "example.com/missing"); !check.OK || check.Status != http.StatusNotFound {
		t.Fatalf("a 404 still proves the registry answers: %+v", check)
	}
}

func TestPrivateRepoCredentialRoundTrip(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	store := isolateGitCredentials(t)
	service := &Service{}

	if status, err := service.PrivateRepoCredentialStatus("git.corp.example"); err != nil || status.Stored {
		t.Fatalf("empty store must report nothing: %+v %v", status, err)
	}
	status, err := service.SavePrivateRepoCredential("git.corp.example", "dev", "s3cret-token")
	if err != nil || !status.Stored || status.Username != "dev" {
		t.Fatalf("save failed: %+v %v", status, err)
	}
	if data, _ := os.ReadFile(store); !strings.Contains(string(data), "git.corp.example") {
		t.Fatalf("credential not handed to the Git helper: %q", data)
	}
	if err := service.RemovePrivateRepoCredential("git.corp.example"); err != nil {
		t.Fatal(err)
	}
	if status, _ := service.PrivateRepoCredentialStatus("git.corp.example"); status.Stored {
		t.Fatal("credential still stored after remove")
	}
	if _, err := service.SavePrivateRepoCredential("https://git.corp.example", "dev", "x"); err == nil {
		t.Fatal("a URL instead of a host must be rejected")
	}
}

// isolateGitCredentials punta Git a un credential store temporaneo, senza config di sistema
// (su Windows il Git Credential Manager scriverebbe nel Credential Manager reale).
func isolateGitCredentials(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	store := filepath.Join(directory, "credentials")
	config := filepath.Join(directory, "gitconfig")
	content := "[credential]\n\thelper = store --file " + filepath.ToSlash(store) + "\n"
	if err := os.WriteFile(config, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", config)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	return store
}
