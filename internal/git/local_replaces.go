package git

import (
	"strings"

	"golang.org/x/mod/modfile"
)

// LocalReplace è un replace verso una cartella locale in un go.mod committato: pubblicato, rompe la
// build di chiunque altro, perché quel percorso esiste solo su questa macchina.
type LocalReplace struct {
	File   string `json:"file"`
	Module string `json:"module"`
	Target string `json:"target"`
}

// LocalReplacesAtHead elenca i replace locali nei go.mod di HEAD, cioè in ciò che un push pubblicherebbe.
func LocalReplacesAtHead(repoPath string) ([]LocalReplace, error) {
	listing, err := runGit(repoPath, "ls-tree", "-r", "--name-only", "HEAD")
	if err != nil {
		return nil, err
	}
	result := []LocalReplace{}
	for _, file := range strings.Split(listing, "\n") {
		file = strings.TrimSpace(file)
		if file != "go.mod" && !strings.HasSuffix(file, "/go.mod") {
			continue
		}
		content, err := readFileAtRef(repoPath, "HEAD", file)
		if err != nil || content == "" {
			continue
		}
		parsed, err := modfile.Parse(file, []byte(content), nil)
		if err != nil {
			continue
		}
		for _, replace := range parsed.Replace {
			if modfile.IsDirectoryPath(replace.New.Path) {
				result = append(result, LocalReplace{File: file, Module: replace.Old.Path, Target: replace.New.Path})
			}
		}
	}
	return result, nil
}
