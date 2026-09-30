package copilot

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	registryURL        = "https://registry.npmjs.org/"
	packagePrefix      = "@github/copilot-language-server-"
	binaryBaseName     = "copilot-language-server"
	installFolderName  = "copilot-language-server"
	currentVersionFile = "current"
	// maxTarballBytes protegge da risposte anomale: il binario reale pesa circa 60 MB compressi.
	maxTarballBytes = 400 << 20
	integrityPrefix = "sha512-"
)

// ServerBinary descrive il Language Server che verrà avviato.
type ServerBinary struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	// Source: "custom" (impostazioni), "managed" (installato da adOmnia) o "path" (PATH di sistema).
	Source string `json:"source"`
}

// InstallProgress è pubblicato durante il download.
type InstallProgress struct {
	Version    string `json:"version"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}

// Installer trova o installa il binario nativo ufficiale del Copilot Language Server.
type Installer struct {
	directory string
	registry  string
	goos      string
	goarch    string
}

// NewInstaller installa sotto dataDirectory/copilot-language-server/<versione>/.
func NewInstaller(dataDirectory string) *Installer {
	return &Installer{directory: filepath.Join(dataDirectory, installFolderName), registry: registryURL, goos: runtime.GOOS, goarch: runtime.GOARCH}
}

// PlatformPackage è il pacchetto npm con il binario per questa piattaforma.
func (i *Installer) PlatformPackage() (string, error) {
	platform := map[string]string{"linux": "linux", "darwin": "darwin", "windows": "win32"}[i.goos]
	arch := map[string]string{"amd64": "x64", "arm64": "arm64"}[i.goarch]
	if platform == "" || arch == "" {
		return "", fmt.Errorf("GitHub Copilot does not ship a language server for %s/%s", i.goos, i.goarch)
	}
	return packagePrefix + platform + "-" + arch, nil
}

func (i *Installer) binaryName() string {
	if i.goos == "windows" {
		return binaryBaseName + ".exe"
	}
	return binaryBaseName
}

// Resolve sceglie il binario: percorso nelle impostazioni, poi installazione gestita, poi PATH.
func (i *Installer) Resolve(settings Settings) (ServerBinary, error) {
	if settings.BinaryPath != "" {
		if !isExecutableFile(settings.BinaryPath) {
			return ServerBinary{}, fmt.Errorf("custom Copilot language server not found at %s", settings.BinaryPath)
		}
		return ServerBinary{Path: settings.BinaryPath, Source: "custom"}, nil
	}
	if version, err := os.ReadFile(filepath.Join(i.directory, currentVersionFile)); err == nil {
		current := strings.TrimSpace(string(version))
		path := filepath.Join(i.directory, current, i.binaryName())
		if isValidVersion(current) && isExecutableFile(path) {
			return ServerBinary{Path: path, Version: current, Source: "managed"}, nil
		}
	}
	if path, err := exec.LookPath(binaryBaseName); err == nil {
		return ServerBinary{Path: path, Source: "path"}, nil
	}
	return ServerBinary{}, ErrServerNotInstalled
}

// ErrServerNotInstalled indica che serve l'installazione (azione esplicita dell'utente).
var ErrServerNotInstalled = errors.New("the GitHub Copilot language server is not installed")

type registryRelease struct {
	Version string `json:"version"`
	Dist    struct {
		Tarball   string `json:"tarball"`
		Integrity string `json:"integrity"`
	} `json:"dist"`
}

// Install scarica l'ultima versione dal registry npm, verifica l'integrità sha512 pubblicata e
// estrae solo l'eseguibile. Parte solo da un'azione dell'utente: adOmnia non scarica nulla da sé.
func (i *Installer) Install(ctx context.Context, settings Settings, progress func(InstallProgress)) (ServerBinary, error) {
	pkg, err := i.PlatformPackage()
	if err != nil {
		return ServerBinary{}, err
	}
	client, err := httpClient(settings)
	if err != nil {
		return ServerBinary{}, err
	}
	release, err := latestRelease(ctx, client, i.registry, pkg)
	if err != nil {
		return ServerBinary{}, err
	}
	target := filepath.Join(i.directory, release.Version)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return ServerBinary{}, fmt.Errorf("cannot create install folder: %w", err)
	}
	archive, err := os.CreateTemp(i.directory, "download-*.tgz")
	if err != nil {
		return ServerBinary{}, err
	}
	defer func() { _ = archive.Close(); _ = os.Remove(archive.Name()) }()
	if err := download(ctx, client, release, archive, progress); err != nil {
		return ServerBinary{}, err
	}
	binary := filepath.Join(target, i.binaryName())
	if err := extractBinary(archive.Name(), "package/"+i.binaryName(), binary); err != nil {
		return ServerBinary{}, err
	}
	if err := os.WriteFile(filepath.Join(i.directory, currentVersionFile), []byte(release.Version), 0o644); err != nil {
		return ServerBinary{}, err
	}
	return ServerBinary{Path: binary, Version: release.Version, Source: "managed"}, nil
}

func latestRelease(ctx context.Context, client *http.Client, registry, pkg string) (registryRelease, error) {
	base, err := url.Parse(registry)
	if err != nil {
		return registryRelease{}, err
	}
	endpoint := registry + url.PathEscape(pkg) + "/latest"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return registryRelease{}, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return registryRelease{}, fmt.Errorf("cannot reach the npm registry (check proxy settings): %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return registryRelease{}, fmt.Errorf("npm registry answered %s", response.Status)
	}
	var release registryRelease
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&release); err != nil {
		return registryRelease{}, fmt.Errorf("unexpected npm registry answer: %w", err)
	}
	if !isValidVersion(release.Version) || !strings.HasPrefix(release.Dist.Integrity, integrityPrefix) {
		return registryRelease{}, errors.New("npm registry answer has no version or sha512 integrity")
	}
	tarball, err := url.Parse(release.Dist.Tarball)
	if err != nil || tarball.Scheme != "https" || tarball.Host != base.Host {
		return registryRelease{}, fmt.Errorf("refusing tarball outside %s", base.Host)
	}
	return release, nil
}

func download(ctx context.Context, client *http.Client, release registryRelease, destination io.Writer, progress func(InstallProgress)) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release.Dist.Tarball, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", response.Status)
	}
	if response.ContentLength > maxTarballBytes {
		return errors.New("download is larger than expected")
	}
	hash := sha512.New()
	counter := &progressWriter{total: response.ContentLength, version: release.Version, report: progress}
	written, err := io.Copy(io.MultiWriter(destination, hash, counter), io.LimitReader(response.Body, maxTarballBytes+1))
	if err != nil {
		return fmt.Errorf("download interrupted: %w", err)
	}
	if written > maxTarballBytes {
		return errors.New("download is larger than expected")
	}
	expected, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(release.Dist.Integrity, integrityPrefix))
	if err != nil || string(expected) != string(hash.Sum(nil)) {
		return errors.New("integrity check failed: the download does not match the sha512 published by npm")
	}
	return nil
}

type progressWriter struct {
	total, done int64
	version     string
	report      func(InstallProgress)
	lastPercent int64
}

func (w *progressWriter) Write(chunk []byte) (int, error) {
	w.done += int64(len(chunk))
	if w.report != nil && w.total > 0 {
		if percent := w.done * 100 / w.total; percent != w.lastPercent {
			w.lastPercent = percent
			w.report(InstallProgress{Version: w.version, Downloaded: w.done, Total: w.total})
		}
	}
	return len(chunk), nil
}

// extractBinary copia dal tarball solo l'entry attesa, scrivendo prima su un file temporaneo.
func extractBinary(archivePath, entryName, destination string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("invalid archive: %w", err)
	}
	defer func() { _ = compressed.Close() }()
	reader := tar.NewReader(compressed)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("archive does not contain %s", entryName)
		}
		if err != nil {
			return fmt.Errorf("invalid archive: %w", err)
		}
		if header.Name != entryName || header.Typeflag != tar.TypeReg {
			continue
		}
		temporary := destination + ".partial"
		output, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			return err
		}
		if _, err := io.Copy(output, io.LimitReader(reader, maxTarballBytes*2)); err != nil {
			_ = output.Close()
			_ = os.Remove(temporary)
			return err
		}
		if err := output.Close(); err != nil {
			return err
		}
		return os.Rename(temporary, destination)
	}
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// isValidVersion accetta solo semver semplici: la versione diventa un nome di cartella.
func isValidVersion(version string) bool {
	if version == "" || len(version) > 32 {
		return false
	}
	for _, char := range version {
		if !(char >= '0' && char <= '9') && char != '.' && !(char >= 'a' && char <= 'z') && char != '-' {
			return false
		}
	}
	return !strings.Contains(version, "..")
}
