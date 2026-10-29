// Package auditskill integra nel Security Center la skill security-audit di Cloudflare
// (https://github.com/cloudflare/security-audit-skill, MIT): la installa, a richiesta e a un commit
// fissato, nella cartella condivisa delle Agent Skills, prepara il prompt per l'agente scelto nella
// chat AI di Code Studio e legge i risultati che la skill scrive (findings.json, REPORT.md).
// L'audit lo esegue l'agente, come Agent Task: questo package non avvia processi.
package auditskill

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
)

const (
	Repository = "github.com/cloudflare/security-audit-skill"
	// Commit è la versione installata: un ref mobile cambierebbe le istruzioni dell'agente senza che l'utente lo veda.
	Commit = "c1c8a8c1471069fb0e188eeaff69b8e8db6564a8"
	Name   = "security-audit"

	markerFile    = ".adomnia-skill.json"
	maxFileBytes  = 2 << 20
	maxTotalBytes = 16 << 20
)

var archiveURL = "https://codeload.github.com/cloudflare/security-audit-skill/tar.gz/" + Commit

// Status descrive la skill vista da adOmnia.
type Status struct {
	Installed bool `json:"installed"`
	// Managed: installata da adOmnia (aggiornabile); altrimenti è dell'utente e non va toccata.
	Managed   bool   `json:"managed"`
	Commit    string `json:"commit,omitempty"`
	Current   bool   `json:"current"`
	Dir       string `json:"dir"`
	SkillFile string `json:"skillFile"`
	// NodeFound: la skill valida findings.json con script Node; senza Node l'agente non può farlo.
	NodeFound bool `json:"nodeFound"`
}

// InstallPlan è ciò che la conferma mostra prima del download.
type InstallPlan struct {
	Command string `json:"command"`
	Note    string `json:"note"`
	Dir     string `json:"dir"`
}

type marker struct {
	Repository string `json:"repository"`
	Commit     string `json:"commit"`
}

// Dir è ~/.agents/skills/security-audit: la cartella dello standard Agent Skills, letta da Pi
// e indicata per percorso assoluto agli altri agenti, così un'installazione vale per tutti.
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot find the home folder: %w", err)
	}
	return filepath.Join(home, ".agents", "skills", Name), nil
}

// Detect legge lo stato senza modificare nulla.
func Detect() (Status, error) {
	dir, err := Dir()
	if err != nil {
		return Status{}, err
	}
	_, nodeErr := exec.LookPath("node")
	status := Status{Dir: dir, SkillFile: filepath.Join(dir, "SKILL.md"), NodeFound: nodeErr == nil}
	if info, err := os.Stat(status.SkillFile); err != nil || !info.Mode().IsRegular() {
		return status, nil
	}
	status.Installed = true
	if data, err := os.ReadFile(filepath.Join(dir, markerFile)); err == nil {
		var installed marker
		if json.Unmarshal(data, &installed) == nil && installed.Commit != "" {
			status.Managed, status.Commit, status.Current = true, installed.Commit, installed.Commit == Commit
		}
	}
	return status, nil
}

// PlanInstall descrive il download che Install eseguirà.
func PlanInstall() (InstallPlan, error) {
	dir, err := Dir()
	if err != nil {
		return InstallPlan{}, err
	}
	return InstallPlan{
		Command: fmt.Sprintf("download %s@%s (skills/%s) → %s", Repository, Commit[:12], Name, dir),
		Note:    "Downloads Cloudflare's security-audit skill (MIT) at a fixed commit from GitHub and copies only its folder. Nothing is executed: the agent you choose reads it when you start an audit.",
		Dir:     dir,
	}, nil
}

// Install scarica il commit fissato e sostituisce solo una copia gestita da adOmnia.
func Install(ctx context.Context) (Status, error) {
	current, err := Detect()
	if err != nil {
		return Status{}, err
	}
	if current.Installed && !current.Managed {
		return current, fmt.Errorf("%s already holds a security-audit skill that adOmnia did not install; it is used as it is", current.Dir)
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	parent := filepath.Dir(current.Dir)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return Status{}, fmt.Errorf("cannot create %s: %w", parent, err)
	}
	// Staging accanto alla destinazione: il rename finale resta sullo stesso volume.
	staging, err := os.MkdirTemp(parent, Name+".download-")
	if err != nil {
		return Status{}, fmt.Errorf("cannot prepare the download folder: %w", err)
	}
	defer func() { _ = os.RemoveAll(staging) }() // dopo il rename resta vuota o assente
	if err := download(ctx, staging); err != nil {
		return Status{}, err
	}
	data, err := json.Marshal(marker{Repository: Repository, Commit: Commit})
	if err != nil {
		return Status{}, err
	}
	if err := os.WriteFile(filepath.Join(staging, markerFile), data, 0o644); err != nil {
		return Status{}, fmt.Errorf("cannot record the installed version: %w", err)
	}
	if err := os.RemoveAll(current.Dir); err != nil {
		return Status{}, fmt.Errorf("cannot replace the previous copy: %w", err)
	}
	if err := os.Rename(staging, current.Dir); err != nil {
		return Status{}, fmt.Errorf("cannot install the skill in %s: %w", current.Dir, err)
	}
	return Detect()
}

func download(ctx context.Context, target string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL, nil)
	if err != nil {
		return err
	}
	response, err := netpolicy.Client("security-skill", 0).Do(request)
	if err != nil {
		return fmt.Errorf("cannot download the skill: %w", err)
	}
	defer func() { _ = response.Body.Close() }() // corpo in sola lettura
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cannot download the skill: GitHub answered %s", response.Status)
	}
	archive, err := gzip.NewReader(response.Body)
	if err != nil {
		return fmt.Errorf("the downloaded archive is not valid: %w", err)
	}
	return extract(tar.NewReader(archive), target)
}

// extract copia soltanto i file regolari di <radice>/skills/security-audit/, con percorsi e dimensioni controllati.
func extract(reader *tar.Reader, target string) error {
	total, files := int64(0), 0
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("the downloaded archive is not valid: %w", err)
		}
		relative, ok := skillPath(header.Name)
		if !ok || header.Typeflag != tar.TypeReg {
			continue
		}
		if header.Size > maxFileBytes || total+header.Size > maxTotalBytes {
			return fmt.Errorf("the downloaded skill is larger than expected (%s)", relative)
		}
		total += header.Size
		destination := filepath.Join(target, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return err
		}
		if err := writeFile(destination, reader, header.Size); err != nil {
			return err
		}
		files++
	}
	if _, err := os.Stat(filepath.Join(target, "SKILL.md")); err != nil {
		return fmt.Errorf("the downloaded archive does not contain skills/%s/SKILL.md", Name)
	}
	if files == 0 {
		return errors.New("the downloaded archive is empty")
	}
	return nil
}

func skillPath(name string) (string, bool) {
	parts := strings.SplitN(path.Clean(name), "/", 4)
	if len(parts) == 2 && parts[1] == "LICENSE" {
		return "LICENSE", true // la licenza MIT viaggia con la copia
	}
	if len(parts) != 4 || parts[1] != "skills" || parts[2] != Name {
		return "", false
	}
	relative := parts[3]
	if relative == "" || path.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, "../") {
		return "", false
	}
	return relative, true
}

func writeFile(destination string, source io.Reader, size int64) error {
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("cannot write %s: %w", filepath.Base(destination), err)
	}
	if _, err := io.CopyN(file, source, size); err != nil {
		_ = file.Close() // il file incompleto sparisce con la cartella di staging
		return fmt.Errorf("cannot write %s: %w", filepath.Base(destination), err)
	}
	return file.Close()
}
