package goide

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/version"
	"os/exec"
	"path"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

const (
	// toolResolveTimeout limita l'intera risoluzione della versione di uno strumento.
	toolResolveTimeout = 60 * time.Second
	// toolResolveMaxQueries limita le invocazioni di `go list` per una singola risoluzione.
	toolResolveMaxQueries = 12
	localGoVersionTimeout = 10 * time.Second
)

// toolIncompatibleError segnala che nessuna versione è compilabile col Go locale: esito definitivo, va in cache.
type toolIncompatibleError struct{ message string }

func (e *toolIncompatibleError) Error() string { return e.message }

// goCommandRunner esegue il comando go indicato; è una variabile così i test evitano la rete.
var goCommandRunner = func(ctx context.Context, goBinary, workDir string, env []string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, goBinary, args...)
	command.Dir = workDir
	command.Env = env
	configureProcess(command, false)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
			return nil, fmt.Errorf("%s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return nil, err
	}
	return output, nil
}

type toolResolution struct {
	resolved string
	note     string
	err      error
}

var (
	toolResolutionMu    sync.Mutex
	toolResolutionCache = map[string]toolResolution{}
)

// withLocalToolchain restituisce una copia di env con GOTOOLCHAIN=local, sostituendo valori esistenti.
func withLocalToolchain(env []string) []string {
	result := make([]string, 0, len(env)+1)
	for _, entry := range env {
		name, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(name, "GOTOOLCHAIN") {
			continue
		}
		result = append(result, entry)
	}
	return append(result, "GOTOOLCHAIN=local")
}

// sdkGoVersion legge la versione del Go SDK selezionato senza rete né cambi di toolchain.
func sdkGoVersion(ctx context.Context, goBinary, workDir string, env []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, localGoVersionTimeout)
	defer cancel()
	output, err := goCommandRunner(ctx, goBinary, workDir, withLocalToolchain(env), "env", "GOVERSION")
	if err != nil {
		return "", fmt.Errorf("unable to read the Go SDK version: %w", err)
	}
	goVersion := strings.TrimSpace(string(output))
	if !version.IsValid(goVersion) {
		return "", fmt.Errorf("unrecognized Go SDK version %q", goVersion)
	}
	return goVersion, nil
}

// toolDisplayName ricava un nome leggibile dal percorso del pacchetto (es. golangci-lint, gopls).
func toolDisplayName(packagePath string) string {
	parts := strings.Split(packagePath, "/")
	for index := len(parts) - 1; index >= 0; index-- {
		part := parts[index]
		if len(part) > 1 && part[0] == 'v' && strings.Trim(part[1:], "0123456789") == "" {
			continue
		}
		return part
	}
	return packagePath
}

// requiredGo normalizza la direttiva go di un go.mod ("1.26.0") nel formato di go/version.
func requiredGo(goVersion string) string {
	goVersion = strings.TrimSpace(goVersion)
	if goVersion == "" {
		return ""
	}
	return "go" + strings.TrimPrefix(goVersion, "go")
}

// goCompatible indica se un modulo che richiede required può essere compilato con localGo.
func goCompatible(required, localGo string) bool {
	return required == "" || version.Compare(required, localGo) <= 0
}

func isStableVersion(v string) bool {
	return semver.IsValid(v) && semver.Prerelease(v) == ""
}

type moduleInfo struct {
	Path      string
	Version   string
	GoVersion string
	Versions  []string
}

type toolResolver struct {
	ctx      context.Context
	goBinary string
	workDir  string
	env      []string
	queries  int
}

func (r *toolResolver) list(args ...string) (moduleInfo, error) {
	if r.queries >= toolResolveMaxQueries {
		return moduleInfo{}, fmt.Errorf("too many module queries (limit %d)", toolResolveMaxQueries)
	}
	r.queries++
	output, err := goCommandRunner(r.ctx, r.goBinary, r.workDir, r.env, append([]string{"list", "-m"}, args...)...)
	if err != nil {
		if r.ctx.Err() != nil {
			return moduleInfo{}, fmt.Errorf("module proxy did not answer in time")
		}
		return moduleInfo{}, err
	}
	var info moduleInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return moduleInfo{}, fmt.Errorf("unexpected go list output: %w", err)
	}
	return info, nil
}

// latestModule trova il modulo che contiene packagePath risalendo il percorso fino a una query @latest valida.
func (r *toolResolver) latestModule(packagePath string) (moduleInfo, error) {
	candidate := packagePath
	var firstErr error
	for strings.Contains(candidate, "/") {
		info, err := r.list("-json", candidate+"@latest")
		if err == nil {
			return info, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		if r.ctx.Err() != nil || r.queries >= toolResolveMaxQueries {
			break
		}
		candidate = path.Dir(candidate)
	}
	return moduleInfo{}, fmt.Errorf("unable to resolve %s@latest: %w", packagePath, firstErr)
}

// newestCompatible cerca per bisezione la versione stabile più recente con GoVersion <= localGo.
// Presuppone che la versione minima di Go richiesta non decresca tra le release.
// Restituisce anche la richiesta di Go più bassa osservata tra le versioni incompatibili.
func (r *toolResolver) newestCompatible(modulePath, latest, latestGo, localGo string) (string, string, error) {
	listing, err := r.list("-versions", "-json", modulePath+"@latest")
	if err != nil {
		return "", "", err
	}
	candidates := make([]string, 0, len(listing.Versions))
	for _, v := range listing.Versions {
		if isStableVersion(v) && semver.Compare(v, latest) < 0 {
			candidates = append(candidates, v)
		}
	}
	low, high, best, minimumGo := 0, len(candidates)-1, "", latestGo
	for low <= high {
		middle := (low + high) / 2
		info, err := r.list("-json", modulePath+"@"+candidates[middle])
		if err != nil {
			return "", "", err
		}
		required := requiredGo(info.GoVersion)
		if goCompatible(required, localGo) {
			best = candidates[middle]
			low = middle + 1
		} else {
			minimumGo = required
			high = middle - 1
		}
	}
	return best, minimumGo, nil
}

// resolveCompatibleToolModule sostituisce @latest con la versione più recente compilabile dal Go locale.
// Non scarica mai toolchain: tutte le query usano GOTOOLCHAIN=local. I moduli senza @latest restano invariati.
func resolveCompatibleToolModule(ctx context.Context, goBinary, workDir string, env []string, module string, localGo string) (string, string, error) {
	packagePath, found := strings.CutSuffix(module, "@latest")
	if !found {
		return module, "", nil
	}
	cacheKey := module + "\x00" + localGo
	toolResolutionMu.Lock()
	cached, ok := toolResolutionCache[cacheKey]
	toolResolutionMu.Unlock()
	if ok {
		return cached.resolved, cached.note, cached.err
	}

	ctx, cancel := context.WithTimeout(ctx, toolResolveTimeout)
	defer cancel()
	resolver := &toolResolver{ctx: ctx, goBinary: goBinary, workDir: workDir, env: withLocalToolchain(env)}
	result, err := resolver.resolve(packagePath, localGo)
	var incompatible *toolIncompatibleError
	if err != nil && !errors.As(err, &incompatible) {
		return "", "", err
	}
	result.err = err
	toolResolutionMu.Lock()
	toolResolutionCache[cacheKey] = result
	toolResolutionMu.Unlock()
	return result.resolved, result.note, result.err
}

func (r *toolResolver) resolve(packagePath, localGo string) (toolResolution, error) {
	name := toolDisplayName(packagePath)
	latest, err := r.latestModule(packagePath)
	if err != nil {
		return toolResolution{}, err
	}
	latestGo := requiredGo(latest.GoVersion)
	if goCompatible(latestGo, localGo) {
		return toolResolution{resolved: packagePath + "@" + latest.Version}, nil
	}
	best, minimumGo, err := r.newestCompatible(latest.Path, latest.Version, latestGo, localGo)
	if err != nil {
		return toolResolution{}, err
	}
	if best == "" {
		return toolResolution{}, &toolIncompatibleError{message: fmt.Sprintf(
			"%s requires go >= %s; the selected SDK is %s. Select a newer Go SDK (Go → Toolchains) — Go Studio does not download Go toolchains automatically",
			name, minimumGo, localGo)}
	}
	note := fmt.Sprintf("%s %s needs %s; installing %s, the newest compatible with %s", name, latest.Version, latestGo, best, localGo)
	return toolResolution{resolved: packagePath + "@" + best, note: note}, nil
}
