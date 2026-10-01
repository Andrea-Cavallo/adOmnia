package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMain isolates the package from the developer's real ~/.claude files.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "adomnia-claude-empty")
	if err != nil {
		panic(err)
	}
	os.Setenv("CLAUDE_CONFIG_DIR", dir)
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

var claudeTestEnvKeys = []string{
	"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL",
	"ANTHROPIC_CUSTOM_HEADERS", "ADOMNIA_AI_API_KEY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
	"https_proxy", "http_proxy", "no_proxy", "CLAUDE_CODE_USE_BEDROCK", "AWS_REGION", "AWS_PROFILE",
	"ANTHROPIC_BEDROCK_BASE_URL",
}

// claudeFixture creates an isolated user config dir and workspace and clears
// relevant process variables (empty counts as unset for every lookup).
type claudeFixture struct {
	userDir   string
	workspace string
}

func newClaudeFixture(t *testing.T) claudeFixture {
	t.Helper()
	for _, key := range claudeTestEnvKeys {
		t.Setenv(key, "")
	}
	root := t.TempDir()
	f := claudeFixture{userDir: filepath.Join(root, "home", ".claude"), workspace: filepath.Join(root, "project")}
	for _, dir := range []string{f.userDir, filepath.Join(f.workspace, ".claude")} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("CLAUDE_CONFIG_DIR", f.userDir)
	return f
}

func (f claudeFixture) path(scope ClaudeCodeScope) string {
	switch scope {
	case ClaudeScopeUser:
		return filepath.Join(f.userDir, "settings.json")
	case ClaudeScopeProject:
		return filepath.Join(f.workspace, ".claude", "settings.json")
	default:
		return filepath.Join(f.workspace, ".claude", "settings.local.json")
	}
}

func (f claudeFixture) write(t *testing.T, scope ClaudeCodeScope, content string) {
	t.Helper()
	if err := os.WriteFile(f.path(scope), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func envJSON(pairs map[string]string, model string) string {
	doc := map[string]any{"env": pairs}
	if model != "" {
		doc["model"] = model
	}
	raw, _ := json.Marshal(doc)
	return string(raw)
}

func TestClaudeCodePrecedence(t *testing.T) {
	cases := []struct {
		name      string
		user      string
		project   string
		local     string
		process   string
		want      string
		wantScope ClaudeCodeScope
	}{
		{name: "user only", user: "https://user", want: "https://user", wantScope: ClaudeScopeUser},
		{name: "project beats user", user: "https://user", project: "https://project", want: "https://project", wantScope: ClaudeScopeProject},
		{name: "local beats project", user: "https://user", project: "https://project", local: "https://local", want: "https://local", wantScope: ClaudeScopeLocal},
		{name: "process beats files", user: "https://user", local: "https://local", process: "https://process", want: "https://process", wantScope: ClaudeScopeProcess},
		{name: "empty local falls through", user: "https://user", local: "", want: "https://user", wantScope: ClaudeScopeUser},
		{name: "nothing", want: "", wantScope: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t)
			for scope, value := range map[ClaudeCodeScope]string{ClaudeScopeUser: tc.user, ClaudeScopeProject: tc.project, ClaudeScopeLocal: tc.local} {
				f.write(t, scope, envJSON(map[string]string{"ANTHROPIC_BASE_URL": value}, ""))
			}
			t.Setenv("ANTHROPIC_BASE_URL", tc.process)
			got, scope := LoadClaudeCodeSettings(f.workspace).Lookup("ANTHROPIC_BASE_URL")
			if got != tc.want || scope != tc.wantScope {
				t.Fatalf("Lookup = (%q, %q), want (%q, %q)", got, scope, tc.want, tc.wantScope)
			}
		})
	}
}

func TestClaudeCodeParsing(t *testing.T) {
	cases := []struct {
		name        string
		content     string
		wantModel   string
		wantHeaders map[string]string
		wantBedrock bool
	}{
		{name: "top-level model", content: `{"model":"claude-corp-1"}`, wantModel: "claude-corp-1"},
		{name: "ANTHROPIC_MODEL beats top-level", content: `{"model":"claude-a","env":{"ANTHROPIC_MODEL":"claude-b"}}`, wantModel: "claude-b"},
		{name: "alias ignored", content: `{"model":"opus"}`, wantModel: ""},
		{name: "custom headers", content: `{"env":{"ANTHROPIC_CUSTOM_HEADERS":"X-Corp: a\nX-Team:  b \nbroken line"}}`, wantHeaders: map[string]string{"X-Corp": "a", "X-Team": "b"}},
		{name: "bool/number env values", content: `{"env":{"CLAUDE_CODE_USE_BEDROCK":1}}`, wantBedrock: true},
		{name: "bedrock string flag", content: `{"env":{"CLAUDE_CODE_USE_BEDROCK":"true"}}`, wantBedrock: true},
		{name: "unknown fields ignored", content: `{"permissions":{"allow":["Bash"]},"hooks":{},"env":{"OTHER":"x"}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t)
			f.write(t, ClaudeScopeUser, tc.content)
			s := LoadClaudeCodeSettings("")
			if got := s.Model(); got != tc.wantModel {
				t.Fatalf("Model() = %q, want %q", got, tc.wantModel)
			}
			headers := s.CustomHeaders()
			if len(headers) != len(tc.wantHeaders) {
				t.Fatalf("headers = %v, want %v", headers, tc.wantHeaders)
			}
			for name, value := range tc.wantHeaders {
				if headers.Get(name) != value {
					t.Fatalf("header %s = %q, want %q", name, headers.Get(name), value)
				}
			}
			if got := s.UsesBedrock(); got != tc.wantBedrock {
				t.Fatalf("UsesBedrock() = %v, want %v", got, tc.wantBedrock)
			}
		})
	}
}

func TestClaudeCodeBadJSONTolerated(t *testing.T) {
	f := newClaudeFixture(t)
	f.write(t, ClaudeScopeLocal, `{"env": {"ANTHROPIC_BASE_URL": "https://local",`)
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{"ANTHROPIC_BASE_URL": "https://user"}, ""))
	s := LoadClaudeCodeSettings(f.workspace)
	if got, _ := s.Lookup("ANTHROPIC_BASE_URL"); got != "https://user" {
		t.Fatalf("Lookup = %q, want user value after invalid local file", got)
	}
	status := s.Status()
	if len(status.Files) != 2 || !status.Files[0].Invalid || status.Files[1].Invalid {
		t.Fatalf("status = %+v, want invalid local + valid user", status)
	}
}

func TestClaudeCodeCacheReloadsOnChange(t *testing.T) {
	f := newClaudeFixture(t)
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{"ANTHROPIC_MODEL": "claude-one"}, ""))

	readsBefore := claudeFileReads
	if got := LoadClaudeCodeSettings("").Model(); got != "claude-one" {
		t.Fatalf("Model() = %q", got)
	}
	for i := 0; i < 50; i++ {
		LoadClaudeCodeSettings("")
	}
	if reads := claudeFileReads - readsBefore; reads != 1 {
		t.Fatalf("file reads = %d, want 1 (cached while unchanged)", reads)
	}

	// Same size, new content: only the mtime reveals the change.
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{"ANTHROPIC_MODEL": "claude-two"}, ""))
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(f.path(ClaudeScopeUser), future, future); err != nil {
		t.Fatal(err)
	}
	if got := LoadClaudeCodeSettings("").Model(); got != "claude-two" {
		t.Fatalf("Model() after mtime change = %q, want claude-two", got)
	}
	if reads := claudeFileReads - readsBefore; reads != 2 {
		t.Fatalf("file reads = %d, want 2 after change", reads)
	}

	// Removal drops the layer.
	if err := os.Remove(f.path(ClaudeScopeUser)); err != nil {
		t.Fatal(err)
	}
	if got := LoadClaudeCodeSettings("").Model(); got != "" {
		t.Fatalf("Model() after removal = %q, want empty", got)
	}
}

func TestClaudeCodeCachedLoadIsCheap(t *testing.T) {
	f := newClaudeFixture(t)
	for _, scope := range []ClaudeCodeScope{ClaudeScopeUser, ClaudeScopeProject, ClaudeScopeLocal} {
		f.write(t, scope, envJSON(map[string]string{"ANTHROPIC_MODEL": "claude-x"}, ""))
	}
	LoadClaudeCodeSettings(f.workspace)
	const n = 200
	start := time.Now()
	for i := 0; i < n; i++ {
		LoadClaudeCodeSettings(f.workspace)
	}
	if avg := time.Since(start) / n; avg > time.Millisecond {
		t.Fatalf("cached load average = %s, want < 1ms", avg)
	}
}

func BenchmarkLoadClaudeCodeSettingsCached(b *testing.B) {
	dir := b.TempDir()
	b.Setenv("CLAUDE_CONFIG_DIR", dir)
	_ = os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"env":{"ANTHROPIC_MODEL":"m"}}`), 0o600)
	for i := 0; i < b.N; i++ {
		LoadClaudeCodeSettings("")
	}
}

func TestClaudeCodeProxySelection(t *testing.T) {
	cases := []struct {
		name       string
		fileEnv    map[string]string
		processEnv map[string]string
		target     string
		want       string
	}{
		{name: "https proxy from file", fileEnv: map[string]string{"HTTPS_PROXY": "http://proxy.corp:8080"}, target: "https://api.anthropic.com/v1/messages", want: "http://proxy.corp:8080"},
		{name: "lower-case file var", fileEnv: map[string]string{"https_proxy": "http://lower.corp:3128"}, target: "https://api.anthropic.com", want: "http://lower.corp:3128"},
		{name: "no_proxy excludes host", fileEnv: map[string]string{"HTTPS_PROXY": "http://proxy.corp:8080", "NO_PROXY": ".internal.corp"}, target: "https://llm.internal.corp/v1/messages", want: ""},
		{name: "http proxy for http target", fileEnv: map[string]string{"HTTP_PROXY": "http://plain.corp:80"}, target: "http://gateway.corp/v1/messages", want: "http://plain.corp:80"},
		{name: "process beats file", fileEnv: map[string]string{"HTTPS_PROXY": "http://file.corp:1"}, processEnv: map[string]string{"HTTPS_PROXY": "http://process.corp:2"}, target: "https://api.anthropic.com", want: "http://process.corp:2"},
		{name: "no proxy configured", target: "https://api.anthropic.com", want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t)
			f.write(t, ClaudeScopeUser, envJSON(tc.fileEnv, ""))
			for key, value := range tc.processEnv {
				t.Setenv(key, value)
			}
			req := httptest.NewRequest(http.MethodGet, tc.target, nil)
			proxyURL, err := LoadClaudeCodeSettings("").ProxyFunc()(req)
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if proxyURL != nil {
				got = proxyURL.String()
			}
			if got != tc.want {
				t.Fatalf("proxy = %q, want %q", got, tc.want)
			}
		})
	}
}

type capturedRequest struct {
	path, auth, apiKey, corp string
	body                     map[string]any
}

func anthropicTestServer(t *testing.T, captured *capturedRequest) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.path = r.URL.Path
		captured.auth = r.Header.Get("Authorization")
		captured.apiKey = r.Header.Get("x-api-key")
		captured.corp = r.Header.Get("X-Corp")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &captured.body)
		w.Header().Set("content-type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/v1/models") {
			_, _ = io.WriteString(w, `{"data":[{"id":"claude-corp-1","display_name":"Corp"}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"content":[{"text":"OK"}],"usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestClaudeCodeAnthropicUsesBaseURLAndCredentials(t *testing.T) {
	cases := []struct {
		name       string
		fileEnv    map[string]string
		processEnv map[string]string
		cfg        Config
		wantAuth   string
		wantAPIKey string
		wantModel  string
	}{
		{
			name:     "auth token as bearer",
			fileEnv:  map[string]string{"ANTHROPIC_AUTH_TOKEN": "corp-token", "ANTHROPIC_MODEL": "claude-corp-1", "ANTHROPIC_CUSTOM_HEADERS": "X-Corp: yes"},
			cfg:      Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeAuto},
			wantAuth: "Bearer corp-token", wantModel: "claude-corp-1",
		},
		{
			name:       "api key from file",
			fileEnv:    map[string]string{"ANTHROPIC_API_KEY": "file-key"},
			cfg:        Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeEnvironment, Model: "claude-explicit"},
			wantAPIKey: "file-key", wantModel: "claude-explicit",
		},
		{
			name:       "process key beats file token",
			fileEnv:    map[string]string{"ANTHROPIC_AUTH_TOKEN": "file-token"},
			processEnv: map[string]string{"ANTHROPIC_API_KEY": "process-key"},
			cfg:        Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeAuto},
			wantAPIKey: "process-key", wantModel: "claude-opus-5-5",
		},
		{
			name:       "adOmnia environment hint beats file key",
			fileEnv:    map[string]string{"ANTHROPIC_API_KEY": "file-key"},
			cfg:        Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeAuto, APIKey: "workspace-key"},
			wantAPIKey: "workspace-key", wantModel: "claude-opus-5-5",
		},
		{
			name:       "vault mode ignores file credentials but keeps gateway",
			fileEnv:    map[string]string{"ANTHROPIC_API_KEY": "file-key"},
			cfg:        Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeVault, APIKey: "vault-key"},
			wantAPIKey: "vault-key", wantModel: "claude-opus-5-5",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t)
			var captured capturedRequest
			srv := anthropicTestServer(t, &captured)
			env := map[string]string{"ANTHROPIC_BASE_URL": srv.URL + "/"}
			for k, v := range tc.fileEnv {
				env[k] = v
			}
			f.write(t, ClaudeScopeProject, envJSON(env, ""))
			for k, v := range tc.processEnv {
				t.Setenv(k, v)
			}
			cfg := tc.cfg
			cfg.WorkspaceDir = f.workspace
			engine, err := New(cfg)
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			resp, err := engine.Complete(context.Background(), CompletionRequest{UserPrompt: "hi", MaxTokens: 5})
			if err != nil || resp.Text != "OK" {
				t.Fatalf("Complete() = %+v, %v", resp, err)
			}
			if captured.path != "/v1/messages" {
				t.Fatalf("path = %q, want /v1/messages on the configured base URL", captured.path)
			}
			if captured.auth != tc.wantAuth || captured.apiKey != tc.wantAPIKey {
				t.Fatalf("auth=%q x-api-key=%q, want %q / %q", captured.auth, captured.apiKey, tc.wantAuth, tc.wantAPIKey)
			}
			if captured.body["model"] != tc.wantModel {
				t.Fatalf("model = %v, want %q", captured.body["model"], tc.wantModel)
			}
			if strings.Contains(tc.name, "bearer") && captured.corp != "yes" {
				t.Fatalf("custom header X-Corp = %q, want yes", captured.corp)
			}
		})
	}
}

func TestClaudeCodeAnthropicModelDiscoveryUsesGateway(t *testing.T) {
	f := newClaudeFixture(t)
	var captured capturedRequest
	srv := anthropicTestServer(t, &captured)
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{"ANTHROPIC_BASE_URL": srv.URL, "ANTHROPIC_AUTH_TOKEN": "tok"}, ""))
	cfg, err := ResolveEnvironmentCredentials(Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeAuto})
	if err != nil {
		t.Fatal(err)
	}
	models, err := DiscoverModels(context.Background(), cfg, "")
	if err != nil {
		t.Fatalf("DiscoverModels() error = %v", err)
	}
	if captured.path != "/v1/models" || captured.auth != "Bearer tok" || len(models) == 0 {
		t.Fatalf("path=%q auth=%q models=%v", captured.path, captured.auth, models)
	}
}

func TestClaudeCodeAnthropicRoutesThroughFileProxy(t *testing.T) {
	f := newClaudeFixture(t)
	var proxied string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = r.URL.String() // absolute-form request target when proxied
		w.Header().Set("content-type", "application/json")
		_, _ = io.WriteString(w, `{"content":[{"text":"via-proxy"}]}`)
	}))
	t.Cleanup(proxy.Close)
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{
		"ANTHROPIC_BASE_URL": "http://gateway.corp.example",
		"ANTHROPIC_API_KEY":  "k",
		"HTTP_PROXY":         proxy.URL,
	}, ""))
	engine, err := New(Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeAuto})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := engine.Complete(context.Background(), CompletionRequest{UserPrompt: "hi"})
	if err != nil || resp.Text != "via-proxy" {
		t.Fatalf("Complete() = %+v, %v", resp, err)
	}
	if proxied != "http://gateway.corp.example/v1/messages" {
		t.Fatalf("proxy saw %q, want the gateway URL", proxied)
	}
}

func TestClaudeCodeMissingCredentialMentionsAuthToken(t *testing.T) {
	newClaudeFixture(t)
	_, err := ResolveEnvironmentCredentials(Config{Provider: ProviderAnthropic, CredentialMode: CredentialModeEnvironment})
	if err == nil || !strings.Contains(err.Error(), "ANTHROPIC_AUTH_TOKEN") {
		t.Fatalf("error = %v, want auth token hint", err)
	}
}

func TestClaudeCodeBedrockSettings(t *testing.T) {
	cases := []struct {
		name        string
		fileEnv     map[string]string
		processEnv  map[string]string
		cfg         Config
		wantRegion  string
		wantProfile string
		wantModel   string
	}{
		{
			name:       "files fill region/profile/model",
			fileEnv:    map[string]string{"CLAUDE_CODE_USE_BEDROCK": "1", "AWS_REGION": "eu-central-1", "AWS_PROFILE": "corp-sso", "ANTHROPIC_MODEL": "eu.anthropic.claude-x"},
			wantRegion: "eu-central-1", wantProfile: "corp-sso", wantModel: "eu.anthropic.claude-x",
		},
		{
			name:       "process region left to the AWS SDK",
			fileEnv:    map[string]string{"AWS_REGION": "eu-central-1"},
			processEnv: map[string]string{"AWS_REGION": "us-east-1"},
			wantRegion: "",
		},
		{
			name:       "explicit settings win",
			fileEnv:    map[string]string{"CLAUDE_CODE_USE_BEDROCK": "1", "AWS_REGION": "eu-central-1", "ANTHROPIC_MODEL": "file-model"},
			cfg:        Config{AWSRegion: "ap-south-1", Model: "explicit-model"},
			wantRegion: "ap-south-1", wantModel: "explicit-model",
		},
		{
			name:      "model needs CLAUDE_CODE_USE_BEDROCK",
			fileEnv:   map[string]string{"ANTHROPIC_MODEL": "claude-first-party"},
			wantModel: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t)
			f.write(t, ClaudeScopeUser, envJSON(tc.fileEnv, ""))
			for k, v := range tc.processEnv {
				t.Setenv(k, v)
			}
			cfg := tc.cfg
			cfg.Provider = ProviderAmazonBedrock
			got, err := ResolveEnvironmentCredentials(cfg)
			if err != nil {
				t.Fatal(err)
			}
			if got.AWSRegion != tc.wantRegion || got.AWSProfile != tc.wantProfile || got.Model != tc.wantModel {
				t.Fatalf("got region=%q profile=%q model=%q", got.AWSRegion, got.AWSProfile, got.Model)
			}
		})
	}
}

func TestClaudeCodeStatusExposesNamesOnly(t *testing.T) {
	f := newClaudeFixture(t)
	f.write(t, ClaudeScopeUser, envJSON(map[string]string{
		"ANTHROPIC_API_KEY": "sk-secret-value", "ANTHROPIC_BASE_URL": "https://gw.secret.example", "UNRELATED": "x",
	}, "claude-corp-1"))
	raw, err := json.Marshal(LoadClaudeCodeSettings(f.workspace).Status())
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range []string{"sk-secret-value", "gw.secret.example", "UNRELATED", "claude-corp-1"} {
		if strings.Contains(text, secret) {
			t.Fatalf("status leaks %q: %s", secret, text)
		}
	}
	if !strings.Contains(text, "ANTHROPIC_API_KEY") || !strings.Contains(text, `"hasModel":true`) {
		t.Fatalf("status = %s, want key names and hasModel", text)
	}
}

func TestAnthropicRootNormalisesBaseURL(t *testing.T) {
	cases := map[string]string{
		"":                              defaultAnthropicBaseURL,
		"https://gw.corp/":              "https://gw.corp",
		"https://gw.corp/v1":            "https://gw.corp",
		"https://gw.corp/anthropic/v1/": "https://gw.corp/anthropic",
	}
	for in, want := range cases {
		if got := anthropicRoot(in); got != want {
			t.Errorf("anthropicRoot(%q) = %q, want %q", in, got, want)
		}
	}
}
