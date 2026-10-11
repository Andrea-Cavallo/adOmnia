package goide

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"adomnia/internal/languages/golang"
)

const binaryBuildTimeout = 5 * time.Minute

// BinaryComparison confronta le dimensioni di un binario fra un ref e oggi.
type BinaryComparison struct {
	Base     string             `json:"base"`
	BaseSize int64              `json:"baseSize"`
	HeadSize int64              `json:"headSize"`
	Packages []BinarySizeChange `json:"packages"`
}

type BinarySizeChange struct {
	Name string `json:"name"`
	Base int64  `json:"base"`
	Head int64  `json:"head"`
}

// buildBinary compila target (un package main relativo a root) in una cartella temporanea e lo ispeziona.
func (s *Service) buildBinary(sessionID, root, target string) (golang.BinaryReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return golang.BinaryReport{}, errors.New("trust the project to build it")
	}
	target = strings.TrimSpace(target)
	if target == "" {
		target = "."
	}
	if err := validateRunTarget(root, root, target); err != nil {
		return golang.BinaryReport{}, err
	}
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return golang.BinaryReport{}, errors.New("go is not available: detect or configure the toolchain")
	}
	environment = withGoFirstInPath(environment, binary)
	temp, err := os.MkdirTemp("", "adomnia-bin-")
	if err != nil {
		return golang.BinaryReport{}, err
	}
	defer os.RemoveAll(temp)
	output := filepath.Join(temp, "app.exe")
	ctx, cancel := context.WithTimeout(context.Background(), binaryBuildTimeout)
	defer cancel()
	run := func(args ...string) ([]byte, error) {
		command := exec.CommandContext(ctx, binary, args...)
		command.Dir, command.Env = root, environment
		configureProcess(command, false)
		return command.CombinedOutput()
	}
	if out, err := run("build", "-o", output, target); err != nil {
		return golang.BinaryReport{}, fmt.Errorf("go build %s: %s", target, strings.TrimSpace(string(out)))
	}
	report, err := golang.ReadBinaryInfo(output)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	report.Path = target
	if out, err := run("tool", "nm", "-size", "-sort", "size", output); err == nil {
		golang.ParseNM(string(out), &report)
	}
	report.Embedded = golang.EmbeddedFiles(filepath.Join(root, filepath.FromSlash(target)))
	return report, nil
}

// InspectBinary compila il package main indicato e ne descrive dimensioni, moduli e metadati.
func (s *Service) InspectBinary(sessionID, target string) (golang.BinaryReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	return s.buildBinary(sessionID, session.Project.RealPath, target)
}

// CompareBinary compila lo stesso package a ref e oggi e confronta le dimensioni per package.
func (s *Service) CompareBinary(sessionID, target, ref string) (BinaryComparison, error) {
	head, err := s.InspectBinary(sessionID, target)
	if err != nil {
		return BinaryComparison{}, err
	}
	var base golang.BinaryReport
	if err := s.withRevision(sessionID, ref, func(root string) error {
		base, err = s.buildBinary(sessionID, root, target)
		return err
	}); err != nil {
		return BinaryComparison{}, err
	}
	sizes := map[string]*BinarySizeChange{}
	for _, item := range base.Packages {
		sizes[item.Name] = &BinarySizeChange{Name: item.Name, Base: item.Size}
	}
	for _, item := range head.Packages {
		if sizes[item.Name] == nil {
			sizes[item.Name] = &BinarySizeChange{Name: item.Name}
		}
		sizes[item.Name].Head = item.Size
	}
	comparison := BinaryComparison{Base: ref, BaseSize: base.Size, HeadSize: head.Size, Packages: []BinarySizeChange{}}
	for _, change := range sizes {
		if change.Base != change.Head {
			comparison.Packages = append(comparison.Packages, *change)
		}
	}
	delta := func(change BinarySizeChange) int64 {
		if d := change.Head - change.Base; d >= 0 {
			return d
		} else {
			return -d
		}
	}
	sort.Slice(comparison.Packages, func(i, j int) bool { return delta(comparison.Packages[i]) > delta(comparison.Packages[j]) })
	if len(comparison.Packages) > 60 {
		comparison.Packages = comparison.Packages[:60]
	}
	return comparison, nil
}
