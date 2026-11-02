package declared

import (
	"path"
	"regexp"
	"strings"
)

// Endpoint is an HTTP route found statically in a source file (no execution, no build): the
// Developer Context turns it into a route entity, so API Workspace, Mock, cURL and Live Session
// see ASP.NET, Laravel/Symfony, Rails/Sinatra, Phoenix and Vapor routes like Go or Spring ones.
type Endpoint struct {
	Method    string // GET, POST… or ANY
	Path      string // as written by the framework, prefixes applied; {id} / :id params
	Line      int    // 1-based
	Handler   string // controller action or method, when the source names it
	Language  string // row id: csharp, php, ruby, elixir, swift
	Framework string
}

// EndpointsInFile dispatches on the file extension; files that cannot hold routes cost one check.
func EndpointsInFile(rel string, data []byte) []Endpoint {
	text := string(data)
	switch strings.ToLower(path.Ext(rel)) {
	case ".cs":
		endpoints := aspnetEndpoints(text)
		for index := range endpoints {
			endpoints[index].Language, endpoints[index].Path = "csharp", cleanParams(endpoints[index].Path)
		}
		return endpoints
	case ".php":
		return phpEndpoints(rel, text)
	case ".rb":
		return rubyEndpoints(rel, text)
	case ".ex":
		return phoenixEndpoints(text)
	case ".swift":
		return vaporEndpoints(text)
	}
	return nil
}

// joinRoute joins a prefix and a path with exactly one slash between them.
func joinRoute(prefix, route string) string {
	joined := strings.Trim(prefix, "/") + "/" + strings.Trim(route, "/")
	return "/" + strings.Trim(joined, "/")
}

// paramPattern rewrites {id?}, {id:int}, {*slug} and {id<\d+>} to {id}: one form for every framework.
var paramPattern = regexp.MustCompile(`\{\*{0,2}([A-Za-z_]\w*)[^}]*\}`)

func cleanParams(route string) string { return paramPattern.ReplaceAllString(route, "{$1}") }

// singular is the naive singular used for nested resource parameters (users → user).
func singular(name string) string {
	name = strings.Trim(name, "/:")
	if index := strings.LastIndex(name, "/"); index >= 0 {
		name = name[index+1:]
	}
	switch {
	case strings.HasSuffix(name, "ies"):
		return strings.TrimSuffix(name, "ies") + "y"
	case strings.HasSuffix(name, "ses"):
		return strings.TrimSuffix(name, "es")
	}
	return strings.TrimSuffix(name, "s")
}

// resourceAction is one conventional route of a REST resource.
type resourceAction struct{ action, method, suffix string }

// resourceRoutes expands a resource declaration; member is the item path segment (":id" or "{photo}").
// keep filters the actions (only:/except:), nil keeps all of them.
func resourceRoutes(base, member string, actions []resourceAction, keep func(string) bool) []Endpoint {
	var out []Endpoint
	for _, action := range actions {
		if keep != nil && !keep(action.action) {
			continue
		}
		route := strings.ReplaceAll(action.suffix, "{member}", member)
		out = append(out, Endpoint{Method: action.method, Path: joinRoute(base, route), Handler: action.action})
	}
	return out
}

// filterActions reads `only:`/`except:` (Rails, Phoenix) or ->only()/->except() (Laravel) lists.
var symbolList = regexp.MustCompile(`(only|except)\W+\[([^\]]*)\]`)
var actionName = regexp.MustCompile(`\w+`)

func filterActions(declaration string) func(string) bool {
	match := symbolList.FindStringSubmatch(declaration)
	if match == nil {
		return nil
	}
	listed := map[string]bool{}
	for _, name := range actionName.FindAllString(match[2], -1) {
		listed[name] = true
	}
	only := match[1] == "only"
	return func(action string) bool { return listed[action] == only }
}

// routeFrame is one Ruby/Elixir do…end block: the prefix of its child routes and, for a resource,
// the resource path (member/collection blocks of Rails build on it).
type routeFrame struct{ prefix, resource string }

// blockStack tracks do…end blocks; blocks that are not routing scopes repeat the parent frame.
type blockStack []routeFrame

func (s blockStack) top() routeFrame {
	if len(s) == 0 {
		return routeFrame{}
	}
	return s[len(s)-1]
}

func (s *blockStack) push(frame routeFrame) { *s = append(*s, frame) }

func (s *blockStack) pop() {
	if len(*s) > 0 {
		*s = (*s)[:len(*s)-1]
	}
}
