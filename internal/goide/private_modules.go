package goide

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"adomnia/internal/netpolicy"
	"golang.org/x/mod/modfile"
	modulepath "golang.org/x/mod/module"
)

// Credenziali dei repository di moduli privati: adOmnia non le salva. Le passa al gestore credenziali
// di Git (Git Credential Manager, Keychain, libsecret…), da cui le leggono sia git sia `go` tramite
// GOAUTH=git. Al frontend torna solo lo username, mai il token.

// PrivateRepoCredential è lo stato delle credenziali di un host nel gestore credenziali di Git.
type PrivateRepoCredential struct {
	Host     string `json:"host"`
	Stored   bool   `json:"stored"`
	Username string `json:"username,omitempty"`
}

// ModuleRegistryCheck è l'esito della prova di un registry di moduli (GOPROXY interno).
type ModuleRegistryCheck struct {
	URL     string `json:"url"`
	Module  string `json:"module"`
	Status  int    `json:"status,omitempty"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

var credentialHostPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$`)

const credentialTimeout = 20 * time.Second

func validCredentialHost(host string) (string, error) {
	host = strings.ToLower(strings.TrimSpace(host))
	if !credentialHostPattern.MatchString(host) || !strings.Contains(host, ".") && !strings.HasPrefix(host, "localhost") {
		return "", fmt.Errorf("host non valido %q: usa solo il nome, es. git.example.com", host)
	}
	return host, nil
}

// runGitCredential esegue `git credential <action>` senza prompt né finestre di login.
func runGitCredential(action, input string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), credentialTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, "git", "-c", "credential.interactive=false", "credential", action)
	command.Dir = filepath.VolumeName(os.TempDir()) + string(filepath.Separator)
	command.Env = append(netpolicy.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "GIT_ASKPASS=", "SSH_ASKPASS=")
	command.Stdin = strings.NewReader(input)
	configureProcess(command, false)
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("git credential %s scaduto", action)
		}
		return "", fmt.Errorf("git credential %s: %s", action, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func credentialHelperConfigured() bool {
	output, err := exec.Command("git", "config", "--get-all", "credential.helper").Output()
	return err == nil && strings.TrimSpace(string(output)) != ""
}

// PrivateRepoCredentialStatus dice se il gestore credenziali di Git conosce l'host (solo lo username).
func (s *Service) PrivateRepoCredentialStatus(host string) (PrivateRepoCredential, error) {
	host, err := validCredentialHost(host)
	if err != nil {
		return PrivateRepoCredential{}, err
	}
	result := PrivateRepoCredential{Host: host}
	output, err := runGitCredential("fill", "protocol=https\nhost="+host+"\n\n")
	if err != nil {
		return result, nil
	}
	values := parseCredentialOutput(output)
	result.Stored = values["password"] != ""
	if result.Stored {
		result.Username = values["username"]
	}
	return result, nil
}

// SavePrivateRepoCredential affida username e token al gestore credenziali di Git.
func (s *Service) SavePrivateRepoCredential(host, username, token string) (PrivateRepoCredential, error) {
	host, err := validCredentialHost(host)
	if err != nil {
		return PrivateRepoCredential{}, err
	}
	username, token = strings.TrimSpace(username), strings.TrimSpace(token)
	if username == "" || token == "" {
		return PrivateRepoCredential{}, errors.New("username e token sono obbligatori")
	}
	if strings.ContainsAny(username+token, "\r\n\x00") {
		return PrivateRepoCredential{}, errors.New("username o token contengono caratteri non validi")
	}
	if !credentialHelperConfigured() {
		return PrivateRepoCredential{}, errors.New("nessun credential helper Git configurato: installa Git Credential Manager (Windows) o imposta credential.helper (osxkeychain, libsecret)")
	}
	if _, err := runGitCredential("approve", fmt.Sprintf("protocol=https\nhost=%s\nusername=%s\npassword=%s\n\n", host, username, token)); err != nil {
		return PrivateRepoCredential{}, err
	}
	return s.PrivateRepoCredentialStatus(host)
}

// RemovePrivateRepoCredential toglie le credenziali dell'host dal gestore credenziali di Git.
func (s *Service) RemovePrivateRepoCredential(host string) error {
	host, err := validCredentialHost(host)
	if err != nil {
		return err
	}
	_, err = runGitCredential("reject", "protocol=https\nhost="+host+"\n\n")
	return err
}

// GoAuthWithGitCredentials è il valore di GOAUTH che fa usare a `go` le credenziali di Git per
// registry e repository privati (Go 1.24+). `go` lo consulta solo dopo una risposta 401/404.
func (s *Service) GoAuthWithGitCredentials() string {
	// GOAUTH divide il comando sugli spazi: serve una cartella assoluta senza spazi, la radice del volume va bene.
	return "netrc;git " + filepath.VolumeName(os.TempDir()) + string(filepath.Separator)
}

func parseCredentialOutput(output string) map[string]string {
	values := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		if key, value, ok := strings.Cut(strings.TrimRight(line, "\r"), "="); ok {
			values[key] = value
		}
	}
	return values
}

// TestModuleRegistry prova il primo GOPROXY della sessione chiedendo l'elenco versioni di un modulo
// richiesto dal progetto, con proxy/CA di adOmnia e, se il registry chiede login, le credenziali di Git.
func (s *Service) TestModuleRegistry(sessionID string) (ModuleRegistryCheck, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ModuleRegistryCheck{}, err
	}
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return ModuleRegistryCheck{}, err
	}
	goproxy := ""
	for _, entry := range environment {
		if name, value, ok := strings.Cut(entry, "="); ok && strings.EqualFold(name, "GOPROXY") {
			goproxy = value
		}
	}
	registry := firstProxyURL(goproxy)
	if registry == "" {
		return ModuleRegistryCheck{Message: "GOPROXY non punta a un registry (è vuoto, off o direct)."}, nil
	}
	module := firstRequiredModule(session.Project.Modules)
	return checkModuleRegistry(registry, module), nil
}

// firstProxyURL restituisce il primo URL http(s) della lista GOPROXY (separatori , e |).
func firstProxyURL(goproxy string) string {
	if strings.TrimSpace(goproxy) == "" {
		goproxy = "https://proxy.golang.org,direct"
	}
	for _, entry := range strings.FieldsFunc(goproxy, func(r rune) bool { return r == ',' || r == '|' }) {
		entry = strings.TrimSpace(entry)
		if strings.HasPrefix(entry, "https://") || strings.HasPrefix(entry, "http://") {
			return strings.TrimRight(entry, "/")
		}
	}
	return ""
}

func firstRequiredModule(modules []GoModule) string {
	for _, module := range modules {
		data, err := os.ReadFile(filepath.Join(module.Path, "go.mod"))
		if err != nil {
			continue
		}
		parsed, err := modfile.Parse("go.mod", data, nil)
		if err != nil {
			continue
		}
		for _, require := range parsed.Require {
			if !require.Indirect {
				return require.Mod.Path
			}
		}
	}
	return "golang.org/x/mod"
}

func checkModuleRegistry(registry, module string) ModuleRegistryCheck {
	result := ModuleRegistryCheck{URL: registry, Module: module}
	escaped, err := modulepath.EscapePath(module)
	if err != nil {
		result.Message = err.Error()
		return result
	}
	endpoint := registry + "/" + escaped + "/@v/list"
	client := netpolicy.Client("go-registry", 20*time.Second)
	response, err := registryGet(client, endpoint, "", "")
	if err == nil && (response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden) {
		if username, password, ok := gitCredentialFor(registry); ok {
			response.Body.Close()
			response, err = registryGet(client, endpoint, username, password)
		}
	}
	if err != nil {
		result.Message = registryErrorMessage(err)
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	switch {
	case response.StatusCode == http.StatusOK:
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		versions := len(strings.Fields(string(body)))
		result.OK = true
		result.Message = fmt.Sprintf("Registry raggiungibile: %d versioni di %s.", versions, module)
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		result.Message = "Il registry chiede il login: salva le credenziali dell'host e attiva GOAUTH con le credenziali Git."
	case response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone:
		result.OK = true
		result.Message = fmt.Sprintf("Registry raggiungibile, ma non serve %s (%d): verifica che il repository virtuale includa i moduli richiesti.", module, response.StatusCode)
	default:
		result.Message = fmt.Sprintf("Il registry ha risposto %d.", response.StatusCode)
	}
	return result
}

func registryGet(client *http.Client, endpoint, username, password string) (*http.Response, error) {
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if password != "" {
		request.SetBasicAuth(username, password)
	}
	return client.Do(request)
}

func registryErrorMessage(err error) string {
	message := err.Error()
	switch {
	case errors.Is(err, netpolicy.ErrOffline):
		return message
	case strings.Contains(message, "x509") || strings.Contains(message, "certificate"):
		return "Certificato TLS non riconosciuto: aggiungi la CA aziendale in Settings → Privacy & Data. (" + message + ")"
	case strings.Contains(message, "proxyconnect"):
		return "Proxy non raggiungibile: controlla il proxy aziendale. (" + message + ")"
	default:
		return "Registry non raggiungibile: " + message
	}
}

// gitCredentialFor chiede al gestore credenziali di Git login e token del registry, senza prompt.
func gitCredentialFor(registry string) (string, string, bool) {
	parsed, err := url.Parse(registry)
	if err != nil || parsed.Host == "" {
		return "", "", false
	}
	output, err := runGitCredential("fill", "protocol="+parsed.Scheme+"\nhost="+parsed.Host+"\n\n")
	if err != nil {
		return "", "", false
	}
	values := parseCredentialOutput(output)
	return values["username"], values["password"], values["password"] != ""
}
