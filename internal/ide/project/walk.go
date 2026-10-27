package project

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// MaxScanDirectories bounds one shared detection walk. Language adapters keep
// their own unit limits on top of it.
const MaxScanDirectories = 4_000

// DirectoryVisit describes one directory handed to every DirectoryVisitor of a
// shared walk: its immediate file names are read once and shared.
type DirectoryVisit struct {
	Path  string   // absolute directory path
	Name  string   // base name; empty for the root
	Depth int      // 0 for the root
	Files []string // immediate non-directory entry names, sorted
}

// DirectoryVisitor consumes a shared directory walk. Returning false stops the
// descent into the children of the visited directory for this visitor only.
type DirectoryVisitor interface {
	VisitDirectory(visit DirectoryVisit) (descend bool)
}

// UnitsVisitor collects the project units of one language from a shared walk.
// Units reports partial results together with the first visitor error.
type UnitsVisitor interface {
	DirectoryVisitor
	Units() ([]Unit, error)
}

// WalkDirectories visits every directory under root exactly once and shares
// each visit with all visitors, so several language detectors scan the disk
// together instead of one walk per detector. Ignored directories are skipped
// for everyone; a visitor that stops descending stops receiving visits for that
// subtree only, the others keep walking. The walk stops after maxDirectories
// directories.
func WalkDirectories(ctx context.Context, root string, maxDirectories int, visitors ...DirectoryVisitor) error {
	if len(visitors) == 0 {
		return nil
	}
	visited := 0
	var walk func(path, name string, depth int, active []bool) error
	walk = func(path, name string, depth int, active []bool) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > maxDirectories {
			return filepath.SkipAll
		}
		// An unreadable directory still gets visited; it just has no children.
		entries, _ := os.ReadDir(path)
		files := make([]string, 0, len(entries))
		children := make([]string, 0, len(entries))
		for _, entry := range entries {
			if entry.IsDir() {
				if IgnoredDirectory(entry.Name()) {
					continue
				}
				children = append(children, entry.Name())
				continue
			}
			files = append(files, entry.Name())
		}
		visit := DirectoryVisit{Path: path, Name: name, Depth: depth, Files: files}
		descend, next := false, make([]bool, len(visitors))
		for index, visitor := range visitors {
			if !active[index] {
				continue
			}
			next[index] = visitor.VisitDirectory(visit)
			if next[index] {
				descend = true
			}
		}
		if !descend {
			return nil
		}
		for _, child := range children {
			if err := walk(filepath.Join(path, child), child, depth+1, next); err != nil {
				return err
			}
		}
		return nil
	}
	active := make([]bool, len(visitors))
	for index := range active {
		active[index] = true
	}
	if err := walk(root, "", 0, active); err != nil && !errors.Is(err, filepath.SkipAll) {
		return err
	}
	return nil
}
