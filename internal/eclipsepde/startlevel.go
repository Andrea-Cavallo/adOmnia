package eclipsepde

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// startLevelConfigFile is the Equinox configuration adOmnia writes under the project
// (launch.go). When it is missing the bundles were never launched: the plan then shows
// the Equinox default.
const startLevelConfigFile = ".adomnia/osgi/configuration/config.ini"

// defaultStartLevel is the Equinox default declared by launch.go.
const defaultStartLevel = 4

// StartLevelPlan is the declared start order of a launch: the default level plus the
// per-bundle instructions of `osgi.bundles`. It is read from the configuration
// adOmnia generated, so it means "the order this project will start in", not a guess.
type StartLevelPlan struct {
	// Default is osgi.bundles.defaultStartLevel.
	Default int
	// Configured is true when the generated config.ini exists.
	Configured bool
	// Entries are the bundles of osgi.bundles with their level and start flag.
	Entries []StartLevelEntry
}

// StartLevelEntry is one `reference:file:…@<level>:start` entry.
type StartLevelEntry struct {
	Location string `json:"location"`
	Level    int    `json:"level"`
	Start    bool   `json:"start"`
}

// ReadStartLevelPlan reads the launch configuration of the project. A missing file is
// not an error: the plan is the framework default.
func ReadStartLevelPlan(root string) StartLevelPlan {
	plan := StartLevelPlan{Default: defaultStartLevel}
	raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(startLevelConfigFile)))
	if err != nil {
		return plan
	}
	properties := parseJavaProperties(string(raw))
	plan.Configured = true
	if value := strings.TrimSpace(properties["osgi.bundles.defaultStartLevel"]); value != "" {
		if level, err := strconv.Atoi(value); err == nil {
			plan.Default = level
		}
	}
	for _, entry := range strings.Split(properties["osgi.bundles"], ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		plan.Entries = append(plan.Entries, parseBundlesEntry(entry, plan.Default))
	}
	return plan
}

// parseBundlesEntry splits one osgi.bundles entry. The instruction is the part after
// the last '@': "4:start", "start" or "4"; no '@' means installed, not started.
func parseBundlesEntry(entry string, defaultLevel int) StartLevelEntry {
	parsed := StartLevelEntry{Level: defaultLevel}
	location := entry
	if before, after, found := strings.CutLast(entry, "@"); found {
		location = before
		instruction := after
		for part := range strings.SplitSeq(instruction, ":") {
			switch {
			case strings.EqualFold(part, "start"):
				parsed.Start = true
			default:
				if level, err := strconv.Atoi(part); err == nil {
					parsed.Level = level
				}
			}
		}
	}
	parsed.Location = strings.TrimPrefix(location, "reference:")
	parsed.Location = strings.TrimPrefix(parsed.Location, "file:")
	return parsed
}

// LevelFor returns the declared level and start flag of a bundle location, matching
// the absolute path or, when the configuration stores another form, the folder/jar
// name.
func (p StartLevelPlan) LevelFor(location string) (level int, start bool, found bool) {
	clean := filepath.Clean(location)
	base := filepath.Base(clean)
	for _, entry := range p.Entries {
		candidate := filepath.Clean(entry.Location)
		if candidate == clean {
			return entry.Level, entry.Start, true
		}
		if filepath.Base(candidate) == base {
			return entry.Level, entry.Start, true
		}
	}
	return p.Default, false, false
}

// parseJavaProperties reads a .properties file: `key=value` or `key:value`, `#`/`!`
// comments and backslash continuations. Unknown escapes are kept literally.
func parseJavaProperties(text string) map[string]string {
	properties := map[string]string{}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		for strings.HasSuffix(line, "\\") && index+1 < len(lines) {
			line = strings.TrimSuffix(line, "\\") + strings.TrimSpace(lines[index+1])
			index++
		}
		key, value, ok := cutProperty(line)
		if !ok {
			continue
		}
		properties[unescapeProperty(strings.TrimSpace(key))] = unescapeProperty(strings.TrimSpace(value))
	}
	return properties
}

// cutProperty splits on the first unescaped '=' or ':'.
func cutProperty(line string) (key, value string, ok bool) {
	for index := 1; index < len(line); index++ {
		char := line[index]
		if line[index-1] == '\\' {
			continue
		}
		if char == '=' || char == ':' {
			return line[:index], line[index+1:], true
		}
	}
	return line, "", false
}

// unescapeProperty undoes the escapes launch.go writes (`\:`, `\=`, `\uXXXX`).
func unescapeProperty(value string) string {
	var out strings.Builder
	for index := 0; index < len(value); index++ {
		char := value[index]
		if char != '\\' || index+1 >= len(value) {
			out.WriteByte(char)
			continue
		}
		index++
		switch escaped := value[index]; escaped {
		case 'u':
			if index+4 < len(value) {
				if code, err := strconv.ParseUint(value[index+1:index+5], 16, 32); err == nil {
					out.WriteRune(rune(code))
					index += 4
					continue
				}
			}
			out.WriteByte(escaped)
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		default:
			out.WriteByte(escaped)
		}
	}
	return out.String()
}
