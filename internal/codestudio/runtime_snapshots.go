package codestudio

import (
	"encoding/json/jsontext"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Le istantanee runtime stanno nel progetto, in .adomnia/snapshots: si confrontano e si condividono.
const snapshotsDir = ".adomnia/snapshots"

var snapshotName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,80}\.json$`)

// RuntimeSnapshotFile è una voce dell'elenco.
type RuntimeSnapshotFile struct {
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

func (s *Service) snapshotsPath(sessionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	return filepath.Join(session.Project.RealPath, filepath.FromSlash(snapshotsDir)), nil
}

// SaveRuntimeSnapshot scrive il JSON (costruito dalla UI) e restituisce il nome del file.
func (s *Service) SaveRuntimeSnapshot(sessionID, label, content string) (string, error) {
	dir, err := s.snapshotsPath(sessionID)
	if err != nil {
		return "", err
	}
	if !jsontext.Value([]byte(content)).IsValid() {
		return "", errors.New("the snapshot is not valid JSON")
	}
	if len(content) > 20<<20 {
		return "", errors.New("the snapshot is larger than 20 MB")
	}
	slug := strings.Trim(regexp.MustCompile(`[^A-Za-z0-9]+`).ReplaceAllString(strings.ToLower(label), "-"), "-")
	if len(slug) > 40 {
		slug = slug[:40]
	}
	name := time.Now().Format("20060102-150405")
	if slug != "" {
		name += "-" + slug
	}
	name += ".json"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return name, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644)
}

// ListRuntimeSnapshots elenca le istantanee, dalla più recente.
func (s *Service) ListRuntimeSnapshots(sessionID string) ([]RuntimeSnapshotFile, error) {
	dir, err := s.snapshotsPath(sessionID)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []RuntimeSnapshotFile{}, nil
	}
	if err != nil {
		return nil, err
	}
	files := []RuntimeSnapshotFile{}
	for _, entry := range entries {
		if entry.IsDir() || !snapshotName.MatchString(entry.Name()) {
			continue
		}
		if info, err := entry.Info(); err == nil {
			files = append(files, RuntimeSnapshotFile{Name: entry.Name(), Size: info.Size(), Modified: info.ModTime()})
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name > files[j].Name })
	return files, nil
}

// LoadRuntimeSnapshot legge un'istantanea per nome (solo file di .adomnia/snapshots).
func (s *Service) LoadRuntimeSnapshot(sessionID, name string) (string, error) {
	if !snapshotName.MatchString(name) {
		return "", fmt.Errorf("invalid snapshot name %q", name)
	}
	dir, err := s.snapshotsPath(sessionID)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, name))
	return string(data), err
}
