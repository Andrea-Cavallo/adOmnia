package nettools

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type folderDiffFile struct {
	Path       string           `json:"path"`
	Name       string           `json:"name"`
	IsDir      bool             `json:"isDir"`
	Status     string           `json:"status"`
	LeftSize   int64            `json:"leftSize,omitempty"`
	RightSize  int64            `json:"rightSize,omitempty"`
	LeftMTime  int64            `json:"leftModified,omitempty"`
	RightMTime int64            `json:"rightModified,omitempty"`
	LeftHash   string           `json:"leftHash,omitempty"`
	RightHash  string           `json:"rightHash,omitempty"`
	Binary     bool             `json:"binary,omitempty"`
	Children   []folderDiffFile `json:"children,omitempty"`
}

type folderDiffFlat struct {
	Path       string `json:"path"`
	Status     string `json:"status"`
	IsDir      bool   `json:"isDir"`
	LeftSize   int64  `json:"leftSize,omitempty"`
	RightSize  int64  `json:"rightSize,omitempty"`
	LeftMTime  int64  `json:"leftModified,omitempty"`
	RightMTime int64  `json:"rightModified,omitempty"`
	Binary     bool   `json:"binary,omitempty"`
}

type fileMeta struct {
	path   string
	name   string
	isDir  bool
	size   int64
	mtime  int64
	hash   string
	binary bool
}

var (
	folderDiffScans  sync.Map
	folderDiffExpiry = 5 * time.Minute
)

type folderDiffSession struct {
	leftRoot  string
	rightRoot string
	expiresAt time.Time
}

func generateScanID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func storeFolderDiffSession(sessionID string, session folderDiffSession) {
	folderDiffScans.Store(sessionID, session)
}

func getFolderDiffSession(sessionID string) (folderDiffSession, bool) {
	v, ok := folderDiffScans.Load(sessionID)
	if !ok {
		return folderDiffSession{}, false
	}
	s, ok := v.(folderDiffSession)
	if !ok || time.Now().After(s.expiresAt) {
		folderDiffScans.Delete(sessionID)
		return folderDiffSession{}, false
	}
	return s, true
}

func init() {
	go func() {
		for {
			time.Sleep(2 * time.Minute)
			folderDiffScans.Range(func(key, value interface{}) bool {
				s, ok := value.(folderDiffSession)
				if !ok || time.Now().After(s.expiresAt) {
					folderDiffScans.Delete(key)
				}
				return true
			})
		}
	}()
}

func folderDiffHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Left      string `json:"left"`
		Right     string `json:"right"`
		MaxFileMB int64  `json:"maxFileMB"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.MaxFileMB <= 0 {
		req.MaxFileMB = 20
	}
	leftRoot, err := filepath.Abs(strings.TrimSpace(req.Left))
	if err != nil || leftRoot == "" {
		http.Error(w, "invalid left path", http.StatusBadRequest)
		return
	}
	rightRoot, err := filepath.Abs(strings.TrimSpace(req.Right))
	if err != nil || rightRoot == "" {
		http.Error(w, "invalid right path", http.StatusBadRequest)
		return
	}
	if err := ensureDir(leftRoot); err != nil {
		http.Error(w, "left path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := ensureDir(rightRoot); err != nil {
		http.Error(w, "right path: "+err.Error(), http.StatusBadRequest)
		return
	}

	left, err := scanFolder(leftRoot, req.MaxFileMB)
	if err != nil {
		http.Error(w, "scan left failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	right, err := scanFolder(rightRoot, req.MaxFileMB)
	if err != nil {
		http.Error(w, "scan right failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	tree, flat := buildFolderDiff(left, right)
	counts := map[string]int{"same": 0, "modified": 0, "left-only": 0, "right-only": 0, "type-change": 0}
	for _, item := range flat {
		if !item.IsDir {
			counts[item.Status]++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	scanID := generateScanID()
	storeFolderDiffSession(scanID, folderDiffSession{
		leftRoot:  leftRoot,
		rightRoot: rightRoot,
		expiresAt: time.Now().Add(folderDiffExpiry),
	})
	json.NewEncoder(w).Encode(map[string]interface{}{
		"scanId":    scanID,
		"leftRoot":  leftRoot,
		"rightRoot": rightRoot,
		"tree":      tree,
		"flat":      flat,
		"counts":    counts,
	})
}

func folderDiffFileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ScanID   string `json:"scanId"`
		Path     string `json:"path"`
		MaxBytes int64  `json:"maxBytes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.ScanID == "" {
		http.Error(w, "scanId required", http.StatusBadRequest)
		return
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 512 * 1024
	}

	session, ok := getFolderDiffSession(req.ScanID)
	if !ok {
		http.Error(w, "invalid or expired scan", http.StatusBadRequest)
		return
	}

	leftRoot, _ := filepath.Abs(session.leftRoot)
	rightRoot, _ := filepath.Abs(session.rightRoot)
	rel := filepath.Clean(req.Path)
	if rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		http.Error(w, "invalid relative path", http.StatusBadRequest)
		return
	}
	leftPath := filepath.Join(leftRoot, rel)
	rightPath := filepath.Join(rightRoot, rel)

	if !strings.HasPrefix(filepath.Clean(leftPath)+string(os.PathSeparator), leftRoot+string(os.PathSeparator)) &&
		leftPath != leftRoot {
		http.Error(w, "path traversal denied", http.StatusForbidden)
		return
	}
	if !strings.HasPrefix(filepath.Clean(rightPath)+string(os.PathSeparator), rightRoot+string(os.PathSeparator)) &&
		rightPath != rightRoot {
		http.Error(w, "path traversal denied", http.StatusForbidden)
		return
	}

	leftText, leftErr := readSmallText(leftPath, req.MaxBytes)
	rightText, rightErr := readSmallText(rightPath, req.MaxBytes)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"path":       rel,
		"left":       leftText,
		"right":      rightText,
		"leftError":  errString(leftErr),
		"rightError": errString(rightErr),
	})
}

func ensureDir(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory")
	}
	return nil
}

func scanFolder(root string, maxFileMB int64) (map[string]fileMeta, error) {
	out := map[string]fileMeta{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == root {
			return nil
		}
		name := entry.Name()
		if name == ".git" || name == "node_modules" || name == "dist" || name == "build" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		meta := fileMeta{path: rel, name: name, isDir: entry.IsDir(), size: info.Size(), mtime: info.ModTime().UnixMilli()}
		if !entry.IsDir() {
			meta.hash, meta.binary = hashFile(path)
		}
		out[rel] = meta
		return nil
	})
	return out, err
}

func hashFile(path string) (string, bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()
	hash := sha256.New()
	buf := make([]byte, 32*1024)
	binary := false
	sampled := 0
	for {
		n, err := f.Read(buf)
		if n > 0 {
			if sampled < 4096 {
				sample := buf[:n]
				if len(sample) > 4096-sampled {
					sample = sample[:4096-sampled]
				}
				if bytes.IndexByte(sample, 0) >= 0 {
					binary = true
				}
				sampled += len(sample)
			}
			if _, writeErr := hash.Write(buf[:n]); writeErr != nil {
				return "", binary
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", binary
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), binary
}

func buildFolderDiff(left, right map[string]fileMeta) ([]folderDiffFile, []folderDiffFlat) {
	all := map[string]bool{}
	for path := range left {
		all[path] = true
	}
	for path := range right {
		all[path] = true
	}
	paths := make([]string, 0, len(all))
	for path := range all {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	root := map[string]*folderDiffFile{}
	flat := make([]folderDiffFlat, 0)
	for _, path := range paths {
		l, hasL := left[path]
		r, hasR := right[path]
		status := "same"
		isDir := false
		name := filepath.Base(path)
		item := folderDiffFile{Path: path, Name: name}
		if hasL {
			item.LeftSize, item.LeftMTime, item.LeftHash, item.Binary, isDir = l.size, l.mtime, l.hash, l.binary, l.isDir
		}
		if hasR {
			item.RightSize, item.RightMTime, item.RightHash, item.Binary, isDir = r.size, r.mtime, r.hash, item.Binary || r.binary, r.isDir
		}
		item.IsDir = isDir
		switch {
		case !hasL:
			status = "right-only"
		case !hasR:
			status = "left-only"
		case l.isDir != r.isDir:
			status = "type-change"
		case l.isDir && r.isDir:
			status = "same"
		case l.size != r.size || l.hash != r.hash:
			status = "modified"
		}
		item.Status = status
		insertDiffNode(root, strings.Split(path, "/"), item)
		flat = append(flat, folderDiffFlat{Path: path, Status: status, IsDir: item.IsDir, LeftSize: item.LeftSize, RightSize: item.RightSize, LeftMTime: item.LeftMTime, RightMTime: item.RightMTime, Binary: item.Binary})
	}
	nodes := mapValues(root)
	propagateDirStatus(nodes)
	return nodes, flat
}

func insertDiffNode(root map[string]*folderDiffFile, parts []string, item folderDiffFile) {
	current := root
	for i, part := range parts {
		node, ok := current[part]
		if !ok {
			node = &folderDiffFile{Path: strings.Join(parts[:i+1], "/"), Name: part, IsDir: i < len(parts)-1, Status: "same"}
			current[part] = node
		}
		if i == len(parts)-1 {
			*node = item
			return
		}
		if node.Children == nil {
			node.Children = []folderDiffFile{}
		}
		childMap := map[string]*folderDiffFile{}
		for idx := range node.Children {
			childMap[node.Children[idx].Name] = &node.Children[idx]
		}
		insertDiffNode(childMap, parts[i+1:], item)
		node.Children = mapValues(childMap)
		return
	}
}

func mapValues(m map[string]*folderDiffFile) []folderDiffFile {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]folderDiffFile, 0, len(keys))
	for _, key := range keys {
		out = append(out, *m[key])
	}
	return out
}

func propagateDirStatus(nodes []folderDiffFile) bool {
	changed := false
	for i := range nodes {
		if len(nodes[i].Children) > 0 {
			childChanged := propagateDirStatus(nodes[i].Children)
			if childChanged && nodes[i].Status == "same" {
				nodes[i].Status = "modified"
			}
			changed = changed || nodes[i].Status != "same"
		} else {
			changed = changed || nodes[i].Status != "same"
		}
	}
	return changed
}

func readSmallText(path string, maxBytes int64) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("directory")
	}
	if info.Size() > maxBytes {
		return "", fmt.Errorf("file too large for preview")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if bytes.IndexByte(data[:min(len(data), 4096)], 0) >= 0 {
		return "", fmt.Errorf("binary file")
	}
	return string(data), nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
