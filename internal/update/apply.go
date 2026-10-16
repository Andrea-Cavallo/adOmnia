package update

import (
	"adomnia/internal/ide/process"
	"adomnia/internal/procutil"
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
	"sync"
	"time"
)

type applyPlan struct {
	Target     string `json:"target"`
	Archive    string `json:"archive"`
	Manifest   string `json:"manifest"`
	Parent     int    `json:"parent"`
	Version    string `json:"version"`
	Executable string `json:"executable"`
	UserData   string `json:"userData"`
	Backup     string `json:"backup"`
}

// fileReleaseTimeout: quanto attendere che Windows o un antivirus rilascino un file (variabile per i test).
var fileReleaseTimeout = 10 * time.Second

const (
	parentExitTimeout    = 2 * time.Minute
	userDataReleaseDelay = 2 * time.Second
	// startupConfirmTimeout: la nuova versione deve aprire la finestra entro questo tempo, altrimenti rollback.
	startupConfirmTimeout = 90 * time.Second
)

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
		m.scheduledPlan = ""
		m.scheduledHelp = ""
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
	if _, err := os.Stat(filepath.Join(m.prepared, entry)); err != nil {
		return m.state, errors.New("The verified package does not contain this platform's application")
	}
	probe, err := os.CreateTemp(filepath.Dir(target), ".adomnia-write-test-*")
	if err != nil {
		return m.state, errors.New("The install directory is not writable; use the installer or package manager")
	}
	probe.Close()
	os.Remove(probe.Name())
	if err := m.prepareScheduledLocked(exe, target); err != nil {
		return m.state, err
	}
	m.state.Scheduled = true
	return m.state, nil
}

// prepareScheduledLocked performs every filesystem operation that can fail
// while the UI is still open. Shutdown only has to start the verified helper.
func (m *Manager) prepareScheduledLocked(exe, target string) error {
	planPath := m.prepared + ".plan.json"
	helper := m.prepared + ".helper"
	if runtime.GOOS == "windows" {
		helper += ".exe"
	}
	if err := removeWithRetry(helper, fileReleaseTimeout); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("cannot replace the previous update helper: %w", err)
	}
	if err := copyRegular(exe, helper, 0700); err != nil {
		return fmt.Errorf("cannot prepare the update helper: %w", err)
	}
	plan := applyPlan{
		Target: target, Archive: m.prepared + ".zip", Manifest: m.prepared + ".json",
		Parent: os.Getpid(), Version: m.state.Version, Executable: exe,
		UserData: filepath.Dir(filepath.Dir(m.dir)), Backup: filepath.Join(m.dir, "previous-install"),
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	tmp := planPath + ".tmp"
	if err = os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	if err = os.Rename(tmp, planPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	m.scheduledPlan = planPath
	m.scheduledHelp = helper
	return nil
}

func (m *Manager) StartScheduled() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.state.Scheduled || m.prepared == "" {
		return nil
	}
	m.state.Scheduled = false
	if m.scheduledPlan == "" || m.scheduledHelp == "" {
		return errors.New("The update helper was not prepared; schedule the update again")
	}
	cmd := procutil.Command(m.scheduledHelp, "--adomnia-update-helper", m.scheduledPlan)
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

func removeWithRetry(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for {
		last = os.RemoveAll(path)
		if last == nil || os.IsNotExist(last) {
			return nil
		}
		if time.Now().After(deadline) {
			return last
		}
		time.Sleep(200 * time.Millisecond)
	}
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
	if p.Backup == "" {
		p.Backup = filepath.Join(root, "previous-install")
	}
	if filepath.Dir(planPath) != root || filepath.Dir(p.Archive) != root || filepath.Dir(p.Manifest) != root || filepath.Dir(p.Backup) != root || p.Parent <= 0 {
		return errors.New("invalid update plan")
	}
	restartAllowed := false
	relaunched := false
	defer func() {
		failurePath := filepath.Join(root, "failed-update.json")
		if result != nil {
			logf("update not applied: %v", result)
			raw, _ := json.Marshal(map[string]string{"version": p.Version, "error": result.Error()})
			_ = os.WriteFile(failurePath, raw, 0600)
		} else {
			_ = os.Remove(failurePath)
		}
		if result != nil && restartAllowed && !relaunched {
			if waitForParent(p.Parent, 30*time.Second) == nil {
				if _, statErr := os.Stat(p.Target); os.IsNotExist(statErr) {
					_ = movePath(p.Backup, p.Target)
				}
				if restartErr := startDesktop(p.Executable, nil); restartErr != nil {
					result = fmt.Errorf("%v; previous version could not be restarted: %w", result, restartErr)
				} else {
					relaunched = true
				}
			}
		}
	}()
	expectedTarget, entry, err := installTarget(p.Executable)
	if err != nil {
		return err
	}
	if expectedTarget != p.Target {
		return errors.New("invalid update destination")
	}
	restartAllowed = true
	logf("updating %s from %s to %s", p.Target, current, p.Version)
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
	asset, err := platformAsset(manifest)
	if err != nil {
		return err
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
	stage, err := os.MkdirTemp(root, "apply-*")
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
		if err = procutil.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", source).Run(); err != nil {
			return errors.New("macOS bundle signature rejected")
		}
	}
	logf("package verified, waiting for adOmnia (pid %d) to close", p.Parent)
	if err = waitForParent(p.Parent, parentExitTimeout); err != nil {
		return err
	}
	if err = waitForUserDataRelease(p.UserData); err != nil {
		return err
	}
	logf("adOmnia closed and its data folder is free")
	backup := p.Backup
	if _, statErr := os.Stat(backup); statErr == nil {
		if _, targetErr := os.Stat(p.Target); os.IsNotExist(targetErr) {
			logf("previous run left no app at %s: restoring it from the backup", p.Target)
			if err = movePath(backup, p.Target); err != nil {
				return fmt.Errorf("cannot restore the previous installation backup: %w", err)
			}
		} else if err = removeWithRetry(backup, fileReleaseTimeout); err != nil {
			return fmt.Errorf("cannot clear a stale update backup: %w", err)
		}
	}
	swap := newInstallSwap(p.Target, backup)
	if err = swap.backup(); err != nil {
		return err
	}
	logf("backup of the installed app ready")
	rollback := func(reason string) error {
		logf("rolling back: %s", reason)
		if err := swap.restore(); err != nil {
			logf("rollback failed: %v", err)
			return err
		}
		logf("previous version restored at %s", p.Target)
		if err := startDesktop(p.Executable, nil); err != nil {
			return fmt.Errorf("previous version restored but could not restart: %w", err)
		}
		relaunched = true
		return nil
	}
	if err = swap.install(source); err != nil {
		if restoreErr := rollback("install failed: " + err.Error()); restoreErr != nil {
			return restoreErr
		}
		return err
	}
	logf("v%s installed at %s", strings.TrimPrefix(p.Version, "v"), p.Target)
	marker := p.Archive + ".started"
	_ = os.Remove(marker)
	_ = os.Remove(marker + rejectedSuffix)
	cmd := newDesktopCommand(p.Executable)
	cmd.Env = append(os.Environ(), "ADOMNIA_UPDATE_CONFIRM="+marker, "ADOMNIA_UPDATE_VERSION="+p.Version)
	if err = cmd.Start(); err != nil {
		if restoreErr := rollback("cannot start the new version: " + err.Error()); restoreErr != nil {
			return restoreErr
		}
		return err
	}
	logf("new version started (pid %d), waiting up to %s for its window", cmd.Process.Pid, startupConfirmTimeout)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	confirmed := func() error {
		logf("new version confirmed its startup")
		swap.finish()
		_ = os.Remove(p.Archive)
		_ = os.Remove(p.Manifest)
		_ = os.Remove(marker)
		_ = os.Remove(planPath)
		return nil
	}
	for deadline := time.Now().Add(startupConfirmTimeout); time.Now().Before(deadline); {
		if reason, readErr := os.ReadFile(marker + rejectedSuffix); readErr == nil {
			_ = cmd.Process.Kill()
			<-done
			_ = os.Remove(marker + rejectedSuffix)
			if restoreErr := rollback(string(reason)); restoreErr != nil {
				return restoreErr
			}
			return fmt.Errorf("Updated app rejected its startup (%s); restored previous version", reason)
		}
		if _, err = os.Stat(marker); err == nil {
			return confirmed()
		}
		select {
		case exitErr := <-done:
			// The child can confirm between the check above and its exit. Once
			// Wait returns, its final marker is visible: do not roll back a
			// successfully confirmed installation just because polling lost the race.
			if _, markerErr := os.Stat(marker); markerErr == nil {
				return confirmed()
			}
			if restoreErr := rollback(fmt.Sprintf("the new version exited before opening its window (%v)", exitStatus(exitErr))); restoreErr != nil {
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
	if restoreErr := rollback("the new version did not open its window in time"); restoreErr != nil {
		return restoreErr
	}
	return errors.New("Updated app did not confirm startup; restored previous version")
}

// exitStatus descrive come è terminato un processo, per il log.
func exitStatus(err error) string {
	if err == nil {
		return "exit code 0"
	}
	return err.Error()
}

// logf scrive un passo dell'helper su stderr, che StartScheduled redirige in apply.log.
func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s %s\n", time.Now().Format("15:04:05.000"), fmt.Sprintf(format, args...))
}

func platformAsset(manifest Manifest) (Asset, error) {
	for _, asset := range manifest.Assets {
		matches := asset.OS == runtime.GOOS && (asset.Arch == runtime.GOARCH || runtime.GOOS == "darwin" && asset.Arch == "universal")
		if !matches {
			continue
		}
		if asset.Size <= 0 || len(asset.SHA256) != sha256.Size*2 || asset.OS == "" || asset.Arch == "" {
			return Asset{}, errors.New("update manifest has an invalid asset for this platform")
		}
		return asset, nil
	}
	return Asset{}, errors.New("update manifest has no asset for this platform")
}

func startDesktop(executable string, env []string) error {
	cmd := newDesktopCommand(executable)
	if env != nil {
		cmd.Env = env
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
	return nil
}

func newDesktopCommand(executable string) *exec.Cmd {
	cmd := exec.Command(executable)
	process.ConfigureDetachedGUI(cmd)
	return cmd
}

func waitForUserDataRelease(dir string) error {
	// WebView2 may outlive the Wails process briefly while releasing its user
	// data locks. Always allow that grace period, then require the directory to
	// accept a create/remove probe before replacing the application.
	time.Sleep(userDataReleaseDelay)
	if dir == "" {
		return nil
	}
	deadline := time.Now().Add(fileReleaseTimeout)
	for {
		probe, err := os.CreateTemp(dir, ".adomnia-update-probe-*")
		if err == nil {
			name := probe.Name()
			_ = probe.Close()
			_ = os.Remove(name)
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("webview user data is still locked: %w", err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func movePath(src, dst string) error {
	deadline := time.Now().Add(fileReleaseTimeout)
	var renameErr error
	for {
		renameErr = renameFile(src, dst)
		if renameErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	info, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("cannot move update files: %w", renameErr)
	}
	if info.IsDir() {
		if err = filepath.Walk(src, func(path string, entry os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel, relErr := filepath.Rel(src, path)
			if relErr != nil {
				return relErr
			}
			target := filepath.Join(dst, rel)
			if entry.IsDir() {
				return os.MkdirAll(target, entry.Mode().Perm())
			}
			return copyRegular(path, target, entry.Mode().Perm())
		}); err != nil {
			return err
		}
	} else if err = copyRegular(src, dst, info.Mode().Perm()); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

// rejectedSuffix: file accanto al marker in cui la nuova versione spiega perché rifiuta l'avvio.
const rejectedSuffix = ".rejected"

// confirmMu serializza le conferme: arrivano sia dal backend (runtime della finestra pronto) sia dal frontend.
var confirmMu sync.Mutex

// ConfirmStartup scrive il marker atteso dall'helper. È idempotente: dopo la prima conferma non fa nulla.
func ConfirmStartup(current string) error {
	confirmMu.Lock()
	defer confirmMu.Unlock()
	marker := os.Getenv("ADOMNIA_UPDATE_CONFIRM")
	version := os.Getenv("ADOMNIA_UPDATE_VERSION")
	if marker == "" {
		return nil
	}
	if !filepath.IsAbs(marker) || !strings.HasSuffix(marker, ".zip.started") {
		return errors.New("invalid startup marker")
	}
	if normalizeVersion(current) != normalizeVersion(version) {
		// L'helper legge il motivo e ripristina subito, invece di attendere il timeout.
		reason := fmt.Sprintf("the installed build reports version %s but the release is %s", current, version)
		_ = os.WriteFile(marker+rejectedSuffix, []byte(reason), 0600)
		return errors.New("updated build version does not match release: " + reason)
	}
	if err := os.WriteFile(marker, []byte(current), 0600); err != nil {
		return err
	}
	_ = os.Unsetenv("ADOMNIA_UPDATE_CONFIRM")
	_ = os.Unsetenv("ADOMNIA_UPDATE_VERSION")
	return nil
}

// OpenApplyLog opens the updater-owned log with the platform text viewer.
func OpenApplyLog(dir string) error {
	path := filepath.Join(dir, "apply.log")
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("update log is not available: %w", err)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "linux":
		cmd = exec.Command("xdg-open", path)
	default:
		cmd = exec.Command("notepad.exe", path)
	}
	process.ConfigureDetachedGUI(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
	return nil
}
