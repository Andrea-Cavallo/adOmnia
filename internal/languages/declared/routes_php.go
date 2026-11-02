package declared

import (
	"regexp"
	"strings"
)

var (
	// Route::get('/users/{id}', …), Route::any(…), Route::match(['get', 'post'], '/x', …)
	laravelVerb  = regexp.MustCompile(`Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]*)['"]`)
	laravelMatch = regexp.MustCompile(`Route::match\s*\(\s*\[([^\]]*)\]\s*,\s*['"]([^'"]*)['"]`)
	// Route::resource('photos', PhotoController::class), Route::apiResource(…)
	laravelResource = regexp.MustCompile(`Route::(resource|apiResource)\s*\(\s*['"]([^'"]*)['"]\s*,\s*([\w\\]+)`)
	// Route::prefix('admin')->…->group(…) or Route::group(['prefix' => 'admin'], …)
	laravelPrefix      = regexp.MustCompile(`prefix\s*\(\s*['"]([^'"]*)['"]`)
	laravelGroupPrefix = regexp.MustCompile(`['"]prefix['"]\s*=>\s*['"]([^'"]*)['"]`)
	// #[Route('/x', methods: ['GET'])] and the annotation form @Route("/x", methods={"GET"})
	symfonyRoute   = regexp.MustCompile(`[#@]\[?Route\s*\(\s*(?:path\s*:\s*)?['"]([^'"]*)['"]([^)]*)`)
	symfonyMethods = regexp.MustCompile(`methods\s*[:=]\s*[\[{]([^\]}]*)`)
	phpClass       = regexp.MustCompile(`\bclass\s+(\w+)`)
	phpFunction    = regexp.MustCompile(`\bfunction\s+(\w+)`)
	quotedWord     = regexp.MustCompile(`['"](\w+)['"]`)
	laravelActions = []resourceAction{{"index", "GET", ""}, {"create", "GET", "create"}, {"store", "POST", ""}, {"show", "GET", "{member}"}, {"edit", "GET", "{member}/edit"}, {"update", "PUT", "{member}"}, {"update", "PATCH", "{member}"}, {"destroy", "DELETE", "{member}"}}
	laravelAPIOnly = map[string]bool{"index": true, "store": true, "show": true, "update": true, "destroy": true}
)

func phpEndpoints(rel, text string) []Endpoint {
	var out []Endpoint
	if strings.Contains(text, "Route::") {
		out = append(out, laravelEndpoints(rel, text)...)
	}
	if strings.Contains(text, "Route(") {
		out = append(out, symfonyEndpoints(text)...)
	}
	for index := range out {
		out[index].Language = "php"
		out[index].Path = cleanParams(out[index].Path)
	}
	return out
}

type braceFrame struct {
	prefix string
	depth  int
}

// laravelEndpoints follows prefix groups by brace depth; routes/api.php gets Laravel's /api prefix.
func laravelEndpoints(rel, text string) []Endpoint {
	base := ""
	if strings.HasSuffix(strings.ReplaceAll(rel, "\\", "/"), "routes/api.php") {
		base = "/api"
	}
	var out []Endpoint
	var frames []braceFrame
	depth := 0
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "*") {
			continue
		}
		prefix := base
		if len(frames) > 0 {
			prefix = frames[len(frames)-1].prefix
		}
		for _, endpoint := range laravelLine(trimmed, prefix) {
			endpoint.Line = index + 1
			out = append(out, endpoint)
		}
		if strings.Contains(trimmed, "group(") {
			if match := laravelPrefix.FindStringSubmatch(trimmed); match != nil {
				frames = append(frames, braceFrame{joinRoute(prefix, match[1]), depth})
			} else if match := laravelGroupPrefix.FindStringSubmatch(trimmed); match != nil {
				frames = append(frames, braceFrame{joinRoute(prefix, match[1]), depth})
			}
		}
		depth += strings.Count(trimmed, "{") - strings.Count(trimmed, "}")
		for len(frames) > 0 && depth <= frames[len(frames)-1].depth && !strings.Contains(trimmed, "group(") {
			frames = frames[:len(frames)-1]
		}
	}
	return out
}

func laravelLine(line, prefix string) []Endpoint {
	var out []Endpoint
	for _, match := range laravelVerb.FindAllStringSubmatch(line, -1) {
		out = append(out, Endpoint{Method: strings.ToUpper(match[1]), Path: joinRoute(prefix, match[2]), Framework: "laravel"})
	}
	if match := laravelMatch.FindStringSubmatch(line); match != nil {
		for _, method := range quotedWord.FindAllStringSubmatch(match[1], -1) {
			out = append(out, Endpoint{Method: strings.ToUpper(method[1]), Path: joinRoute(prefix, match[2]), Framework: "laravel"})
		}
	}
	if match := laravelResource.FindStringSubmatch(line); match != nil {
		keep := filterActions(line)
		if match[1] == "apiResource" {
			inner := keep
			keep = func(action string) bool { return laravelAPIOnly[action] && (inner == nil || inner(action)) }
		}
		controller := match[3][strings.LastIndex(match[3], "\\")+1:]
		for _, endpoint := range resourceRoutes(joinRoute(prefix, match[2]), "{"+singular(match[2])+"}", laravelActions, keep) {
			endpoint.Handler = controller + "@" + endpoint.Handler
			endpoint.Framework = "laravel"
			out = append(out, endpoint)
		}
	}
	return out
}

// symfonyEndpoints: a Route attribute before the class is the prefix of the action routes.
func symfonyEndpoints(text string) []Endpoint {
	var out []Endpoint
	var class, classRoute string
	var pending []string // path, then the attribute arguments
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if match := symfonyRoute.FindStringSubmatch(trimmed); match != nil {
			pending = []string{match[1], match[2]}
			continue
		}
		if match := phpClass.FindStringSubmatch(trimmed); match != nil {
			class, classRoute = match[1], ""
			if pending != nil {
				classRoute, pending = pending[0], nil
			}
			continue
		}
		match := phpFunction.FindStringSubmatch(trimmed)
		if match == nil || pending == nil {
			continue
		}
		methods := []string{"ANY"}
		if list := symfonyMethods.FindStringSubmatch(pending[1]); list != nil {
			methods = methods[:0]
			for _, method := range quotedWord.FindAllStringSubmatch(list[1], -1) {
				methods = append(methods, strings.ToUpper(method[1]))
			}
		}
		for _, method := range methods {
			out = append(out, Endpoint{Method: method, Path: joinRoute(classRoute, pending[0]), Line: index + 1,
				Handler: class + "::" + match[1], Framework: "symfony"})
		}
		pending = nil
	}
	return out
}
