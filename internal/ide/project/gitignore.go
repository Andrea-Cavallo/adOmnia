package project

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// GitIgnore è il sottoinsieme di .gitignore della radice del progetto che serve a watcher, ricerca e quick open:
// pattern con * ? **, ancoraggio con "/", solo-cartella con "/" finale, negazione con "!". L'ultima regola che
// corrisponde vince. Non legge .gitignore annidati né quelli globali: restano comunque valide le cartelle di IgnoredDirectory.
type GitIgnore struct {
	rules []gitIgnoreRule
}

type gitIgnoreRule struct {
	re      *regexp.Regexp
	dirOnly bool
	negate  bool
}

// LoadGitIgnore legge <root>/.gitignore; un file assente o illeggibile equivale a nessuna regola.
func LoadGitIgnore(root string) *GitIgnore {
	file, err := os.Open(filepath.Join(root, ".gitignore"))
	if err != nil {
		return &GitIgnore{}
	}
	defer file.Close()
	ignore := &GitIgnore{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if rule, ok := parseGitIgnoreLine(scanner.Text()); ok {
			ignore.rules = append(ignore.rules, rule)
		}
	}
	return ignore
}

// Ignored dice se il percorso relativo (con "/") è escluso. Va chiamato sul singolo elemento durante la visita:
// una cartella esclusa viene saltata per intero dal chiamante.
func (g *GitIgnore) Ignored(relative string, isDir bool) bool {
	if g == nil || relative == "" {
		return false
	}
	relative = strings.Trim(filepath.ToSlash(relative), "/")
	ignored := false
	for _, rule := range g.rules {
		if rule.dirOnly && !isDir {
			continue
		}
		if rule.re.MatchString(relative) {
			ignored = !rule.negate
		}
	}
	return ignored
}

func parseGitIgnoreLine(line string) (gitIgnoreRule, bool) {
	line = strings.TrimRight(strings.TrimSuffix(line, "\r"), " \t")
	if line == "" || strings.HasPrefix(line, "#") {
		return gitIgnoreRule{}, false
	}
	rule := gitIgnoreRule{}
	if strings.HasPrefix(line, "!") {
		rule.negate, line = true, line[1:]
	}
	if strings.HasSuffix(line, "/") {
		rule.dirOnly, line = true, strings.TrimSuffix(line, "/")
	}
	anchored := strings.Contains(line, "/")
	line = strings.TrimPrefix(line, "/")
	if line == "" {
		return gitIgnoreRule{}, false
	}
	var expr strings.Builder
	expr.WriteString("^")
	if !anchored {
		expr.WriteString("(?:.*/)?")
	}
	for i := 0; i < len(line); i++ {
		switch c := line[i]; c {
		case '*':
			if i+1 < len(line) && line[i+1] == '*' {
				i++
				if i+1 < len(line) && line[i+1] == '/' {
					i++
					expr.WriteString("(?:.*/)?")
				} else {
					expr.WriteString(".*")
				}
			} else {
				expr.WriteString("[^/]*")
			}
		case '?':
			expr.WriteString("[^/]")
		default:
			expr.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	expr.WriteString("$")
	re, err := regexp.Compile(expr.String())
	if err != nil {
		return gitIgnoreRule{}, false
	}
	rule.re = re
	return rule, true
}
