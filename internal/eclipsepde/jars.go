package eclipsepde

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LooseJarResult is the outcome of importing single JARs into the active target folder.
type LooseJarResult struct {
	TargetPath string   `json:"targetPath"`
	Imported   []string `json:"imported"`
	Skipped    []string `json:"skipped"`
}

// ImportLooseJars copies the chosen JARs into the active target platform folder after
// checking that each one is a real bundle. It only accepts a target that is a folder of
// bundles: writing into an Eclipse installation or a `.target` definition is not
// something adOmnia should do silently, so those targets are refused with a clear
// message.
func ImportLooseJars(root string, files []string) (*LooseJarResult, error) {
	if len(files) == 0 {
		return nil, fmt.Errorf("choose at least one JAR")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	settings, err := LoadTargetSettings(absRoot)
	if err != nil {
		return nil, err
	}
	settings = absoluteProfiles(settings, absRoot)
	profile, ok := activeProfile(settings)
	if !ok {
		return nil, fmt.Errorf("choose a target platform first: Java › OSGi Control Center › Target")
	}
	if profile.Kind != TargetLocalDirectory {
		return nil, fmt.Errorf("the active target is %s: adding JARs needs a folder of bundles (choose one in Target)", profile.Kind)
	}
	info, err := os.Stat(profile.Path)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("the target folder %s does not exist", profile.Path)
	}
	result := &LooseJarResult{TargetPath: profile.Path, Imported: []string{}, Skipped: []string{}}
	for _, file := range files {
		name := filepath.Base(file)
		if !strings.EqualFold(filepath.Ext(file), ".jar") {
			result.Skipped = append(result.Skipped, name+": not a JAR")
			continue
		}
		raw, err := readJarManifest(file)
		if err != nil {
			result.Skipped = append(result.Skipped, name+": "+err.Error())
			continue
		}
		if _, err := ParseBundle(raw, file); err != nil {
			result.Skipped = append(result.Skipped, name+": not an OSGi bundle ("+err.Error()+")")
			continue
		}
		destination := filepath.Join(profile.Path, name)
		if _, err := os.Stat(destination); err == nil {
			result.Skipped = append(result.Skipped, name+": already in the target folder")
			continue
		}
		if err := copyFile(file, destination); err != nil {
			result.Skipped = append(result.Skipped, name+": "+err.Error())
			continue
		}
		result.Imported = append(result.Imported, destination)
	}
	sort.Strings(result.Imported)
	sort.Strings(result.Skipped)
	if len(result.Imported) > 0 {
		InvalidateTargetIndex(profile.Path)
	}
	return result, nil
}

// activeProfile returns the active profile of the settings.
func activeProfile(settings TargetSettings) (TargetProfile, bool) {
	for _, profile := range settings.Profiles {
		if profile.Name == settings.Active {
			return profile, true
		}
	}
	return TargetProfile{}, false
}

// copyFile copies one file with a temporary name and a rename: a half-copied jar must
// never end up in a target platform.
func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".adomnia-jar-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	if _, err := io.Copy(temporary, input); err != nil {
		_ = temporary.Close()
		_ = os.Remove(name)
		return err
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, destination); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
