package codestudio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
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

// executable è un binario compilato in una cartella temporanea, con l'ambiente per eseguirlo.
type executable struct {
	path, goBinary string
	environment    []string
	cleanup        func()
	run            func(ctx context.Context, args ...string) ([]byte, error)
}

// buildExecutable compila target (un package main relativo a root) in una cartella temporanea.
func (s *Service) buildExecutable(ctx context.Context, sessionID, root, target string) (executable, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return executable{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return executable{}, errors.New("trust the project to build it")
	}
	if err := validateRunTarget(root, root, target); err != nil {
		return executable{}, err
	}
	environment, err := s.executionEnvironment(SessionID(sessionID), golang.ID, s.withSharedEnvironment(nil))
	if err != nil {
		return executable{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return executable{}, errors.New("go is not available: detect or configure the toolchain")
	}
	environment = withGoFirstInPath(environment, binary)
	temp, err := os.MkdirTemp("", "adomnia-bin-")
	if err != nil {
		return executable{}, err
	}
	built := executable{path: filepath.Join(temp, "app.exe"), goBinary: binary, environment: environment, cleanup: func() { _ = os.RemoveAll(temp) }}
	built.run = func(ctx context.Context, args ...string) ([]byte, error) {
		command := procutil.CommandContext(ctx, binary, args...)
		command.Dir, command.Env = root, environment
		configureProcess(command, false)
		return command.CombinedOutput()
	}
	if out, err := built.run(ctx, "build", "-o", built.path, target); err != nil {
		built.cleanup()
		return executable{}, fmt.Errorf("go build %s: %s", target, strings.TrimSpace(string(out)))
	}
	return built, nil
}

// buildBinary compila target e lo ispeziona.
func (s *Service) buildBinary(sessionID, root, target string) (golang.BinaryReport, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		target = "."
	}
	ctx, cancel := context.WithTimeout(context.Background(), binaryBuildTimeout)
	defer cancel()
	built, err := s.buildExecutable(ctx, sessionID, root, target)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	defer built.cleanup()
	report, err := golang.ReadBinaryInfo(built.path)
	if err != nil {
		return golang.BinaryReport{}, err
	}
	report.Path = target
	if out, err := built.run(ctx, "tool", "nm", "-size", "-sort", "size", built.path); err == nil {
		golang.ParseNMInFile(string(out), &report, golang.FileBackedRanges(built.path))
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
