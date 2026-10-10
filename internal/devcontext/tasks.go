package devcontext

import (
	"bytes"
	"path"
	"regexp"
	"strings"
)

// Local-environment tasks: database migrations and seed data a project runs
// before its services. Each is a "task" entity with attrs role (migration|seed),
// runner (go|make|golang-migrate|goose) and what the runner needs (dir, target).
// Only go and make tasks are runnable as-is; SQL migration folders are reported
// so the developer can wire their tool and DSN.

var (
	migrationName = regexp.MustCompile(`^(db[-_]?)?migrat(e|es|ion|ions|or)([-_]?(up|db))?$`)
	seedName      = regexp.MustCompile(`^(db[-_]?)?(seed|seeds|seeder|seeding|fixtures)([-_]?db)?$`)
	makeTarget    = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:([^=]|$)`)
)

// taskRole classifies a directory or Make target name.
func taskRole(name string) string {
	name = strings.ToLower(name)
	switch {
	case migrationName.MatchString(name):
		return "migration"
	case seedName.MatchString(name):
		return "seed"
	}
	return ""
}

func isMakefile(base string) bool {
	return base == "Makefile" || base == "makefile" || base == "GNUmakefile"
}

// goTask turns a `package main` directory named like cmd/migrate into a task.
func goTask(dir string, src Source) (Entity, bool) {
	role := taskRole(path.Base(dir))
	if role == "" || dir == "." {
		return Entity{}, false
	}
	return entity("task", "go:"+dir, path.Base(dir), ConfidenceInferred,
		map[string]string{"role": role, "runner": "go", "dir": dir}, src), true
}

// detectMakefile reports migrate/seed targets of a Makefile.
func detectMakefile(rel string, data []byte) ([]Entity, error) {
	var out []Entity
	for i, line := range strings.Split(string(data), "\n") {
		match := makeTarget.FindStringSubmatch(line)
		if match == nil || strings.HasPrefix(line, "\t") {
			continue
		}
		role := taskRole(match[1])
		if role == "" {
			continue
		}
		out = append(out, entity("task", "make:"+rel+":"+match[1], "make "+match[1], ConfidenceCertain,
			map[string]string{"role": role, "runner": "make", "file": rel, "target": match[1]}, Source{"makefile", rel, i + 1}))
	}
	return out, nil
}

// detectSQLMigration reports a folder of golang-migrate (`*.up.sql`) or goose
// (`-- +goose Up`) migrations; seed SQL is not run automatically.
func detectSQLMigration(rel string, data []byte) ([]Entity, error) {
	runner := ""
	switch {
	case strings.HasSuffix(strings.ToLower(rel), ".up.sql"):
		runner = "golang-migrate"
	case bytes.Contains(data, []byte("-- +goose Up")):
		runner = "goose"
	default:
		return nil, nil
	}
	dir := path.Dir(rel)
	return []Entity{entity("task", runner+":"+dir, dir, ConfidenceCertain,
		map[string]string{"role": "migration", "runner": runner, "dir": dir}, Source{"sqlmigration", rel, 1})}, nil
}
