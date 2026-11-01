package project

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
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

// gitIgnoreCache evita di rileggere e ricompilare .gitignore a ogni cartella aperta, ricerca o indice:
// una voce vale finché mtime e dimensione del file non cambiano. Le regole sono immutabili, quindi condivise.
var gitIgnoreCache = struct {
	sync.Mutex
	byRoot map[string]cachedGitIgnore
}{byRoot: map[string]cachedGitIgnore{}}

// maxCachedGitIgnores limita la cache ai progetti recenti; oltre si riparte da vuota.
const maxCachedGitIgnores = 64

type cachedGitIgnore struct {
	modTime time.Time
	size    int64
	ignore  *GitIgnore
}

// LoadGitIgnore legge <root>/.gitignore; un file assente o illeggibile equivale a nessuna regola.
func LoadGitIgnore(root string) *GitIgnore {
	info, err := os.Stat(filepath.Join(root, ".gitignore"))
	if err != nil {
		return &GitIgnore{}
	}
	gitIgnoreCache.Lock()
	cached, ok := gitIgnoreCache.byRoot[root]
	gitIgnoreCache.Unlock()
	if ok && cached.size == info.Size() && cached.modTime.Equal(info.ModTime()) {
		return cached.ignore
	}
	ignore := readGitIgnore(root)
	gitIgnoreCache.Lock()
	if len(gitIgnoreCache.byRoot) >= maxCachedGitIgnores {
		gitIgnoreCache.byRoot = map[string]cachedGitIgnore{}
	}
	gitIgnoreCache.byRoot[root] = cachedGitIgnore{modTime: info.ModTime(), size: info.Size(), ignore: ignore}
	gitIgnoreCache.Unlock()
	return ignore
}

func readGitIgnore(root string) *GitIgnore {
	file, err := os.Open(filepath.Join(root, ".gitignore"))
	if err != nil {
		return &GitIgnore{}
	}
	defer func() { _ = file.Close() }()
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
	if before, ok := strings.CutSuffix(line, "/"); ok {
		rule.dirOnly, line = true, before
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
