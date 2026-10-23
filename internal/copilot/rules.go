package copilot

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"unicode/utf8"
)

const maxProjectRuleBytes = 8 * 1024

var projectRuleNames = [...]string{".rules", "AGENTS.md", "CLAUDE.md", ".cursorrules"}

type ProjectRule struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitzero"`
}

// ProjectRules reads only the four regular root files, at send time. Missing,
// excluded, linked, binary or unreadable files are skipped, never executed.
func ProjectRules(root string) []ProjectRule {
	rules := []ProjectRule{}
	filter := LoadContextFilter(root)
	directory, err := os.OpenRoot(root)
	if err != nil {
		return rules
	}
	defer directory.Close()
	for _, name := range projectRuleNames {
		if filter.Excluded(name) {
			continue
		}
		info, err := os.Lstat(filepath.Join(root, name))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		file, err := directory.Open(name)
		if err != nil {
			continue
		}
		opened, err := file.Stat()
		if err != nil || !os.SameFile(info, opened) {
			file.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(file, maxProjectRuleBytes+1))
		file.Close()
		if err != nil || bytes.IndexByte(data, 0) >= 0 {
			continue
		}
		truncated := len(data) > maxProjectRuleBytes
		if truncated {
			data = data[:maxProjectRuleBytes]
			for trim := 0; trim < utf8.UTFMax-1 && len(data) > 0 && !utf8.Valid(data); trim++ {
				data = data[:len(data)-1]
			}
		}
		if len(bytes.TrimSpace(data)) == 0 || !utf8.Valid(data) {
			continue
		}
		rules = append(rules, ProjectRule{Path: name, Text: string(data), Truncated: truncated})
	}
	return rules
}
