package eclipsepde

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Java 6 support (spec section 9): distinguish the JDK that runs the tools from
// the bytecode level of the produced classes and from the libraries on the
// compile classpath. These helpers give the fail-fast checks of section 11:
// verify target compatibility before building, never silently compile too new.

// majorClassVersion maps an execution environment to the highest class-file
// major version it accepts (Java 6 = major 50, Java 5 = 49, Java 8 = 52...).
var majorClassVersion = map[string]uint16{
	"J2SE-1.5":   49,
	"JavaSE-1.6": 50,
	"JavaSE-1.7": 51,
	"JavaSE-1.8": 52,
}

// ParseExecutionEnvironment extracts the Java version from a
// Bundle-RequiredExecutionEnvironment value ("JavaSE-1.6" → 1.6).
func ParseExecutionEnvironment(ee string) (string, error) {
	ee = strings.TrimSpace(ee)
	if ee == "" {
		return "", fmt.Errorf("empty execution environment")
	}
	// Take the trailing numeric part: "JavaSE-1.6" → "1.6".
	idx := strings.LastIndex(ee, "-")
	if idx < 0 || idx == len(ee)-1 {
		return "", fmt.Errorf("unrecognized execution environment %q", ee)
	}
	version := ee[idx+1:]
	if _, err := strconv.ParseFloat(version, 64); err != nil {
		return "", fmt.Errorf("unrecognized execution environment %q: %w", ee, err)
	}
	return version, nil
}

// MaxClassVersion returns the highest class-file major version an execution
// environment accepts. ok is false for EE values whose level is unknown.
func MaxClassVersion(ee string) (uint16, bool) {
	major, ok := majorClassVersion[strings.TrimSpace(ee)]
	return major, ok
}

// ClassFileVersion reads the major version from a .class file header
// (magic 0xCAFEBABE, minor, major).
func ClassFileVersion(data []byte) (uint16, error) {
	if len(data) < 8 {
		return 0, fmt.Errorf("class file too short")
	}
	if binary.BigEndian.Uint32(data[:4]) != 0xCAFEBABE {
		return 0, fmt.Errorf("not a class file: bad magic")
	}
	return binary.BigEndian.Uint16(data[6:8]), nil
}

// BytecodeProblem describes one class compiled above the allowed level.
type BytecodeProblem struct {
	// File is the class file path, relative to the scanned root.
	File string
	// Major is the class-file major version found.
	Major uint16
	// MaxMajor is the highest major the execution environment accepts.
	MaxMajor uint16
}

// String renders the problem as an actionable message.
func (p BytecodeProblem) String() string {
	return fmt.Sprintf("%s is compiled for class version %d (major), above the execution environment maximum %d",
		p.File, p.Major, p.MaxMajor)
}

// CheckBytecodeLevel scans root for .class files and reports those compiled
// above the given execution environment (spec section 9: "distinguere JDK che
// esegue il tool da versione dei bytecode generati"). Only reads files.
func CheckBytecodeLevel(root, executionEnvironment string) ([]BytecodeProblem, error) {
	maxMajor, ok := MaxClassVersion(executionEnvironment)
	if !ok {
		return nil, fmt.Errorf("unknown execution environment %q: cannot judge bytecode level", executionEnvironment)
	}
	var problems []BytecodeProblem
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are not bytecode problems
		}
		if d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".class") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		major, parseErr := ClassFileVersion(data)
		if parseErr != nil {
			return nil
		}
		if major > maxMajor {
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				rel = path
			}
			problems = append(problems, BytecodeProblem{
				File:     filepath.ToSlash(rel),
				Major:    major,
				MaxMajor: maxMajor,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return problems, nil
}
