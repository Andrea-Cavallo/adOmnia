package devcontext

import (
	"path"
	"regexp"
	"strings"
)

// springconfig entities carry the HTTP root path declared by the project
// configuration. They are internal: linkHandlers applies the path and drops
// them before the snapshot is returned.
const springConfigKind = "springconfig"

var (
	propertiesContextPath = regexp.MustCompile(`(?m)^\s*(?:server\.servlet\.context-path|server\.context-path|quarkus\.http\.root-path)\s*=\s*([^\s#]+)`)
	yamlContextPath       = regexp.MustCompile(`(?m)^\s*(?:context-path|root-path)\s*:\s*['"]?([^'"\s#]+)`)
)

func isSpringConfig(base string) bool {
	if !strings.HasPrefix(base, "application") && !strings.HasPrefix(base, "bootstrap") {
		return false
	}
	switch path.Ext(base) {
	case ".properties", ".yml", ".yaml":
		return true
	}
	return false
}

func detectSpringConfig(rel string, data []byte) []Entity {
	if !isSpringConfig(path.Base(rel)) {
		return nil
	}
	text := string(data)
	var value string
	if strings.HasSuffix(rel, ".properties") {
		value = firstMatch(propertiesContextPath, text)
	} else {
		value = firstMatch(yamlContextPath, text)
	}
	value = normalizeContextPath(value)
	if value == "" {
		return nil
	}
	return []Entity{entity(springConfigKind, rel, value, ConfidenceInferred,
		map[string]string{"contextPath": value}, Source{"springconfig", rel, 1})}
}

func firstMatch(pattern *regexp.Regexp, text string) string {
	match := pattern.FindStringSubmatch(text)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func normalizeContextPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "/" {
		return ""
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return strings.TrimSuffix(value, "/")
}

// javaContextPath returns the single root path declared by the project. Several
// different values (profiles, modules) are not applied: a wrong prefix is worse
// than no prefix.
func javaContextPath(configs []Entity) string {
	paths := map[string]bool{}
	for _, config := range configs {
		if value := config.Attrs["contextPath"]; value != "" {
			paths[value] = true
		}
	}
	if len(paths) != 1 {
		return ""
	}
	for value := range paths {
		return value
	}
	return ""
}

func applyContextPath(route *Entity, prefix string) {
	if prefix == "" || !strings.HasSuffix(route.Attrs["declFile"], ".java") {
		return
	}
	current := route.Attrs["path"]
	if current == "" || current == prefix || strings.HasPrefix(current, prefix+"/") {
		return
	}
	combined := prefix + "/" + strings.TrimPrefix(current, "/")
	route.Attrs["path"] = combined
	route.Attrs["contextPath"] = prefix
	route.Label = route.Attrs["method"] + " " + combined
	route.ID = "route:" + route.Label
}
