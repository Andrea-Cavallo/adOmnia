package milk

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	// RepoURL è il progetto upstream: adOmnia installa le sue release, mai una copia propria.
	RepoURL = "https://github.com/scoutme/milk"
	// MinVersion è la prima release con `milk serve --acp`.
	MinVersion      = "0.4.0"
	versionTimeout  = 10 * time.Second
	maxBinaryBytes  = 200 << 20
	maxMetadataSize = 4 << 20
)

// releasesAPI è una variabile solo per i test, che la puntano a un server locale.
var releasesAPI = "https://api.github.com/repos/scoutme/milk/releases?per_page=30"

var versionPattern = regexp.MustCompile(`v?(\d+)\.(\d+)\.(\d+)`)

// parseVersion estrae x.y.z da `milk --version` o da un tag; ok=false se non c'è.
func parseVersion(text string) (version [3]int, ok bool) {
	match := versionPattern.FindStringSubmatch(text)
	if match == nil {
		return version, false
	}
	for i := range version {
		version[i], _ = strconv.Atoi(match[i+1])
	}
	return version, true
}

func versionAtLeast(text, minimum string) bool {
	have, ok := parseVersion(text)
	want, _ := parseVersion(minimum)
	if !ok {
		return false
	}
	for i := range have {
		if have[i] != want[i] {
			return have[i] > want[i]
		}
	}
	return true
}

// installedVersion legge la versione del binario con `milk --version`.
func installedVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), versionTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--version")
	configureProcess(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("cannot run %s --version: %w", binary, err)
	}
	version, ok := parseVersion(string(out))
	if !ok {
		return "", fmt.Errorf("unrecognized milk version: %s", strings.TrimSpace(string(out)))
	}
	return fmt.Sprintf("v%d.%d.%d", version[0], version[1], version[2]), nil
}

// DefaultInstallPath è dove installano gli script ufficiali di milk:
// %LOCALAPPDATA%\milk\bin\milk.exe su Windows, ~/.local/bin/milk altrove.
func DefaultInstallPath() (string, error) {
	if runtime.GOOS == "windows" {
		local := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
		if local == "" {
			return "", errors.New("LOCALAPPDATA is not set")
		}
		return filepath.Join(local, "milk", "bin", "milk.exe"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "bin", "milk"), nil
}

// assetName è il nome del binario nelle release di milk per questa piattaforma.
func assetName() string {
	name := fmt.Sprintf("milk-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type release struct {
	Tag        string         `json:"tag_name"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
	Assets     []releaseAsset `json:"assets"`
}

// pickRelease sceglie la release più recente (anche pre-release: milk pubblica
// solo quelle) che è almeno MinVersion e ha binario + checksum per asset.
func pickRelease(releases []release, asset string) (release, releaseAsset, releaseAsset, error) {
	var best *release
	var binary, checksum releaseAsset
	for i := range releases {
		candidate := &releases[i]
		if candidate.Draft || !versionAtLeast(candidate.Tag, MinVersion) {
			continue
		}
		var bin, sum releaseAsset
		for _, a := range candidate.Assets {
			switch a.Name {
			case asset:
				bin = a
			case asset + ".sha256":
				sum = a
			}
		}
		if bin.URL == "" || sum.URL == "" {
			continue
		}
		if best == nil || newer(candidate.Tag, best.Tag) {
			best, binary, checksum = candidate, bin, sum
		}
	}
	if best == nil {
		return release{}, releaseAsset{}, releaseAsset{}, fmt.Errorf("no milk release ≥ v%s has a %s binary", MinVersion, asset)
	}
	return *best, binary, checksum, nil
}

func newer(a, b string) bool {
	va, _ := parseVersion(a)
	vb, _ := parseVersion(b)
	for i := range va {
		if va[i] != vb[i] {
			return va[i] > vb[i]
		}
	}
	return false
}

func getBody(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "adOmnia")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", url, response.Status)
	}
	return response, nil
}

func getSmall(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	response, err := getBody(ctx, client, url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	return io.ReadAll(io.LimitReader(response.Body, maxMetadataSize))
}

// installRelease scarica l'ultima release di milk, ne verifica lo SHA-256
// pubblicato e la mette in destination sostituendo il binario in modo atomico.
func installRelease(ctx context.Context, client *http.Client, destination string, progress func(string)) (string, error) {
	progress("Looking for the latest milk release…")
	raw, err := getSmall(ctx, client, releasesAPI)
	if err != nil {
		return "", fmt.Errorf("cannot list milk releases: %w", err)
	}
	var releases []release
	if err := json.Unmarshal(raw, &releases); err != nil {
		return "", fmt.Errorf("cannot read milk releases: %w", err)
	}
	chosen, binary, checksumAsset, err := pickRelease(releases, assetName())
	if err != nil {
		return "", err
	}

	sumText, err := getSmall(ctx, client, checksumAsset.URL)
	if err != nil {
		return "", fmt.Errorf("cannot download the checksum: %w", err)
	}
	fields := strings.Fields(string(sumText))
	if len(fields) == 0 || len(fields[0]) != sha256.Size*2 {
		return "", errors.New("the published checksum is not a SHA-256")
	}
	expected := strings.ToLower(fields[0])

	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", filepath.Dir(destination), err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".milk-download-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(temporary.Name()) // dopo il rename non esiste più: errore ignorato

	response, err := getBody(ctx, client, binary.URL)
	if err != nil {
		temporary.Close()
		return "", fmt.Errorf("cannot download milk %s: %w", chosen.Tag, err)
	}
	hash := sha256.New()
	counter := &progressWriter{total: binary.Size, report: func(percent int) {
		progress(fmt.Sprintf("Downloading milk %s… %d%%", chosen.Tag, percent))
	}}
	written, copyErr := io.Copy(io.MultiWriter(temporary, hash, counter), io.LimitReader(response.Body, maxBinaryBytes+1))
	response.Body.Close()
	closeErr := temporary.Close()
	switch {
	case copyErr != nil:
		return "", fmt.Errorf("download interrupted: %w", copyErr)
	case closeErr != nil:
		return "", closeErr
	case written > maxBinaryBytes:
		return "", errors.New("the milk download is unexpectedly large")
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != expected {
		return "", fmt.Errorf("checksum mismatch for milk %s: refusing to install", chosen.Tag)
	}
	if err := os.Chmod(temporary.Name(), 0o755); err != nil {
		return "", err
	}
	progress("Installing milk " + chosen.Tag + "…")
	if err := os.Rename(temporary.Name(), destination); err != nil {
		return "", fmt.Errorf("cannot replace %s (is milk running elsewhere?): %w", destination, err)
	}
	return chosen.Tag, nil
}

// progressWriter riporta la percentuale solo quando cambia.
type progressWriter struct {
	total, done int64
	last        int
	report      func(int)
}

func (p *progressWriter) Write(data []byte) (int, error) {
	p.done += int64(len(data))
	if p.total > 0 {
		if percent := int(p.done * 100 / p.total); percent != p.last {
			p.last = percent
			p.report(percent)
		}
	}
	return len(data), nil
}
