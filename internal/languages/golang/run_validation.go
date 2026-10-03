package golang

import (
	"adomnia/internal/ide/project"
	"fmt"
	"path/filepath"
	"strings"
)

func ValidateGoArguments(root, workingDirectory string, arguments []string) error {
	pathFlags := map[string]bool{"-o": true, "-overlay": true, "-modfile": true, "-pkgdir": true}
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if strings.ContainsRune(argument, '\x00') {
			return fmt.Errorf("flag Go non valido")
		}
		flag, value, hasValue := strings.Cut(argument, "=")
		if !pathFlags[flag] {
			continue
		}
		if !hasValue {
			index++
			if index >= len(arguments) {
				return fmt.Errorf("%s richiede un percorso", flag)
			}
			value = arguments[index]
		}
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s richiede un percorso", flag)
		}
		candidate := filepath.FromSlash(value)
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(workingDirectory, candidate)
		}
		if err := project.EnsureWithin(root, filepath.Clean(candidate)); err != nil {
			return fmt.Errorf("percorso di %s non consentito: %w", flag, err)
		}
		if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
			if err := project.EnsureWithin(root, resolved); err != nil {
				return fmt.Errorf("percorso di %s non consentito: %w", flag, err)
			}
		}
	}
	return nil
}
