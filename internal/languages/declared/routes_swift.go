package declared

import (
	"regexp"
	"strings"
)

var (
	// app.get("hello", ":name") { … } — users.post(use: create) — api.get("todos", use: index)
	vaporVerb = regexp.MustCompile(`\b(\w+)\s*\.\s*(get|post|put|patch|delete)\s*\(([^)]*)\)`)
	// let api = app.grouped("api", "v1")
	vaporGrouped = regexp.MustCompile(`\b(\w+)\s*=\s*(\w+)\s*\.\s*grouped\s*\(([^)]*)\)`)
	// app.group("users") { users in
	vaporGroup  = regexp.MustCompile(`\b(\w+)\s*\.\s*group\s*\(([^)]*)\)\s*\{\s*(\w+)\s+in`)
	swiftString = regexp.MustCompile(`"([^"]*)"`)
	vaporUse    = regexp.MustCompile(`use:\s*([\w.]+)`)
)

// vaporPath joins the string literals of a call (path components, ":id" parameters).
func vaporPath(arguments string) string {
	if index := strings.Index(arguments, "use:"); index >= 0 {
		arguments = arguments[:index]
	}
	var parts []string
	for _, match := range swiftString.FindAllStringSubmatch(arguments, -1) {
		parts = append(parts, match[1])
	}
	return strings.Join(parts, "/")
}

// vaporEndpoints reads Vapor route builders, following grouped(…) and group(…) { x in } prefixes.
func vaporEndpoints(text string) []Endpoint {
	if !strings.Contains(text, "import Vapor") {
		return nil
	}
	var out []Endpoint
	// Only route builders: req.parameters.get("id") is not a route.
	groups := map[string]string{"app": "", "routes": "", "router": ""}
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") {
			continue
		}
		if match := vaporGrouped.FindStringSubmatch(trimmed); match != nil {
			groups[match[1]] = joinRoute(groups[match[2]], vaporPath(match[3]))
		}
		if match := vaporGroup.FindStringSubmatch(trimmed); match != nil {
			groups[match[3]] = joinRoute(groups[match[1]], vaporPath(match[2]))
		}
		for _, match := range vaporVerb.FindAllStringSubmatch(trimmed, -1) {
			if _, builder := groups[match[1]]; !builder {
				continue
			}
			handler := ""
			if use := vaporUse.FindStringSubmatch(match[3]); use != nil {
				handler = use[1]
			}
			out = append(out, Endpoint{Method: strings.ToUpper(match[2]), Path: joinRoute(groups[match[1]], vaporPath(match[3])),
				Line: index + 1, Handler: handler, Language: "swift", Framework: "vapor"})
		}
	}
	return out
}
