package update

import (
	"adomnia/internal/ide/process"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type applyPlan struct {
	Target     string `json:"target"`
	Archive    string `json:"archive"`
	Manifest   string `json:"manifest"`
	Parent     int    `json:"parent"`
	Version    string `json:"version"`
	Executable string `json:"executable"`
}

func installTarget(exe string) (string, string, error) {
	exe, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", "", err
	}
	if runtime.GOOS == "darwin" {
		target := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
		if !strings.HasSuffix(target, ".app") || filepath.Base(filepath.Dir(exe)) != "MacOS" {
			return "", "", errors.New("Updates require an installed macOS app bundle")
		}
		return target, "adomnia.app", nil
	}
	if runtime.GOOS == "linux" && (strings.HasPrefix(exe, "/usr/") || strings.HasPrefix(exe, "/opt/") || strings.HasPrefix(exe, "/snap/") || os.Getenv("FLATPAK_ID") != "") {
		return "", "", errors.New("This installation is managed by the system; update it through your package manager")
	}
	entry := "adomnia"
	if runtime.GOOS == "windows" {
		entry += ".exe"
	}
	return exe, entry, nil
}

// Schedule never closes the app. Normal close guards remain in charge; only
// after all services and storage have shut down will StartScheduled run.
func (m *Manager) Schedule(enable bool) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !enable {
		m.state.Scheduled = false
		return m.state, nil
	}
	if m.prepared == "" || m.busy {
		return m.state, errors.New("No verified update is ready")
	}
	exe, err := os.Executable()
	if err != nil {
		return m.state, err
	}
	target, entry, err := installTarget(exe)
	if err != nil {
		return m.state, err
	}
	if _, err := os.Stat(target + ".adomnia-previous"); err == nil {
		return m.state, errors.New("A previous update backup remains; review the previous update before installing another")
	}
	if _, err := os.Stat(filepath.Join(m.prepared, entry)); err != nil {
		return m.state, errors.New("The verified package does not contain this platform's application")
	}
	probe, err := os.CreateTemp(filepath.Dir(target), ".adomnia-write-test-*")
	if err != nil {
		return m.state, errors.New("The install directory is not writable; use the installer or package manager")
	}
	probe.Close()
	os.Remove(probe.Name())
	m.state.Scheduled = true
	return m.state, nil
}
func (m *Manager) StartScheduled() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.state.Scheduled || m.prepared == "" {
		return nil
	}
	m.state.Scheduled = false
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	target, _, err := installTarget(exe)
	if err != nil {
		return err
	}
	plan := applyPlan{Target: target, Archive: m.prepared + ".zip", Manifest: m.prepared + ".json", Parent: os.Getpid(), Version: m.state.Version, Executable: exe}
	raw, _ := json.Marshal(plan)
	planPath := m.prepared + ".plan.json"
	if err = os.WriteFile(planPath, raw, 0600); err != nil {
		return err
	}
	helper := m.prepared + ".helper"
	if runtime.GOOS == "windows" {
		helper += ".exe"
	}
	if err = copyRegular(exe, helper, 0700); err != nil {
		return err
	}
	cmd := exec.Command(helper, "--adomnia-update-helper", planPath)
	process.Configure(cmd, false)
	logFile, err := os.OpenFile(filepath.Join(m.dir, "apply.log"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err = cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()
	return nil
}
func copyRegular(src, dst string, mode os.FileMode) error {
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if e != nil {
		return e
	}
	_, e = io.Copy(out, in)
	if e == nil {
		e = out.Sync()
	}
	ce := out.Close()
	if e != nil {
		return e
	}
	return ce
}

// Helper runs before Wails startup and waits for the original process to exit.
func RunHelper(planPath, current string) (result error) {
	raw, err := os.ReadFile(planPath)
	if err != nil {
		return err
	}
	var p applyPlan
	if err = json.Unmarshal(raw, &p); err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, _ = filepath.EvalSymlinks(self)
	root := filepath.Dir(self)
	if filepath.Dir(planPath) != root || filepath.Dir(p.Archive) != root || filepath.Dir(p.Manifest) != root || p.Parent <= 0 {
		return errors.New("invalid update plan")
	}
	defer func() {
		failurePath := filepath.Join(root, "failed-update.json")
		if result != nil {
			raw, _ := json.Marshal(map[string]string{"version": p.Version, "error": result.Error()})
			_ = os.WriteFile(failurePath, raw, 0600)
		} else {
			_ = os.Remove(failurePath)
		}
	}()
	expectedTarget, entry, err := installTarget(p.Executable)
	if err != nil {
		return err
	}
	if expectedTarget != p.Target {
		return errors.New("invalid update destination")
	}
	raw, err = os.ReadFile(p.Manifest)
	if err != nil {
		return err
	}
	manifest, err := VerifyEnvelope(raw, PublicKey)
	if err != nil {
		return err
	}
	if normalizeVersion(manifest.Version) != normalizeVersion(p.Version) {
		return errors.New("invalid update version")
	}
	if CompareSemver(p.Version, current) <= 0 {
		return errors.New("update downgrade rejected")
	}
	var asset Asset
	for _, a := range manifest.Assets {
		if a.OS == runtime.GOOS && (a.Arch == runtime.GOARCH || runtime.GOOS == "darwin" && a.Arch == "universal") {
			asset = a
			break
		}
	}
	archive, err := os.Open(p.Archive)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(archive, maxPackageSize+1))
	archive.Close()
	if err != nil || n != asset.Size || hex.EncodeToString(h.Sum(nil)) != strings.ToLower(asset.SHA256) {
		return errors.New("staged update checksum rejected")
	}
	stage, err := os.MkdirTemp(filepath.Dir(p.Target), ".adomnia-update-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err = extractPackage(p.Archive, stage); err != nil {
		return err
	}
	source := filepath.Join(stage, entry)
	if _, err = os.Stat(source); err != nil {
		return errors.New("missing executable in update package")
	}
	if runtime.GOOS == "darwin" {
		if err = exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", source).Run(); err != nil {
			return errors.New("macOS bundle signature rejected")
		}
	}
	if err = waitForParent(p.Parent, 24*time.Hour); err != nil {
		return err
	}
	backup := p.Target + ".adomnia-previous"
	if _, err = os.Stat(backup); err == nil {
		return errors.New("Previous update backup exists; refusing to overwrite it")
	}
	if err = os.Rename(p.Target, backup); err != nil {
		return err
	}
	rollback := func() error {
		if err := os.RemoveAll(p.Target); err != nil {
			return fmt.Errorf("cannot remove failed update; previous app retained at %s: %w", backup, err)
		}
		if err := os.Rename(backup, p.Target); err != nil {
			return fmt.Errorf("cannot restore previous app at %s: %w", backup, err)
		}
		cmd := exec.Command(p.Executable)
		process.Configure(cmd, false)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("previous version restored but could not restart: %w", err)
		}
		if cmd.Process != nil {
			_ = cmd.Process.Release()
		}
		return nil
	}
	if err = os.Rename(source, p.Target); err != nil {
		if restoreErr := rollback(); restoreErr != nil {
			return restoreErr
		}
		return err
	}
	marker := p.Archive + ".started"
	_ = os.Remove(marker)
	cmd := exec.Command(p.Executable)
	cmd.Env = append(os.Environ(), "ADOMNIA_UPDATE_CONFIRM="+marker, "ADOMNIA_UPDATE_VERSION="+p.Version)
	process.Configure(cmd, false)
	if err = cmd.Start(); err != nil {
		if restoreErr := rollback(); restoreErr != nil {
			return restoreErr
		}
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	for deadline := time.Now().Add(90 * time.Second); time.Now().Before(deadline); {
		if _, err = os.Stat(marker); err == nil {
			_ = os.RemoveAll(backup)
			_ = os.Remove(p.Archive)
			_ = os.Remove(p.Manifest)
			_ = os.Remove(marker)
			_ = os.Remove(planPath)
			return nil
		}
		select {
		case <-done:
			if restoreErr := rollback(); restoreErr != nil {
				return restoreErr
			}
			return errors.New("Updated app exited before startup confirmation; restored previous version")
		case <-time.After(500 * time.Millisecond):
		}
	}
	// Never restore over a live application. Kill only our newly started child,
	// wait for file handles to close, then restore the old executable/bundle.
	_ = cmd.Process.Kill()
	<-done
	if restoreErr := rollback(); restoreErr != nil {
		return restoreErr
	}
	return errors.New("Updated app did not confirm startup; restored previous version")
}
func ConfirmStartup(current string) error {
	marker := os.Getenv("ADOMNIA_UPDATE_CONFIRM")
	version := os.Getenv("ADOMNIA_UPDATE_VERSION")
	if marker == "" {
		return nil
	}
	if normalizeVersion(current) != normalizeVersion(version) {
		return fmt.Errorf("updated build version does not match release")
	}
	if !filepath.IsAbs(marker) || !strings.HasSuffix(marker, ".zip.started") {
		return errors.New("invalid startup marker")
	}
	if err := os.WriteFile(marker, []byte(current), 0600); err != nil {
		return err
	}
	_ = os.Unsetenv("ADOMNIA_UPDATE_CONFIRM")
	_ = os.Unsetenv("ADOMNIA_UPDATE_VERSION")
	return nil
}
