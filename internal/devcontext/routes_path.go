package devcontext

import (
	"regexp"
	"strings"
)

var pathParam = regexp.MustCompile(`^(?::([A-Za-z_]\w*)|\{([A-Za-z_]\w*)(?::[^}]*)?\})$`)

// normalizePath makes gin/echo (:id), chi/stdlib ({id}) and gorilla
// ({id:regex}) paths comparable, so code and OpenAPI routes merge.
func normalizePath(p string) string {
	segments := strings.Split(p, "/")
	for i, s := range segments {
		if m := pathParam.FindStringSubmatch(s); m != nil {
			name := m[1]
			if name == "" {
				name = m[2]
			}
			segments[i] = "{" + name + "}"
		}
	}
	out := strings.Join(segments, "/")
	if len(out) > 1 {
		out = strings.TrimSuffix(out, "/")
	}
	if out == "" {
		return "/"
	}
	return out
}

func routeEntity(method, rawPath, confidence string, attrs map[string]string, src Source) Entity {
	p := normalizePath(rawPath)
	if attrs == nil {
		attrs = map[string]string{}
	}
	attrs["method"], attrs["path"] = method, p
	key := method + " " + p
	return entity("route", key, key, confidence, attrs, src)
}
