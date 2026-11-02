package declared

import (
	"regexp"
	"strings"
)

var (
	// get "/users/:id", UserController, :show — live "/dashboard", DashboardLive
	phoenixVerb      = regexp.MustCompile(`^(get|post|put|patch|delete|options|head|live)\s*\(?\s*"([^"]*)"\s*,\s*([\w.]+)(?:\s*,\s*:(\w+))?`)
	phoenixScope     = regexp.MustCompile(`^scope\s*\(?\s*"([^"]*)"`)
	phoenixResources = regexp.MustCompile(`^resources\s*\(?\s*"([^"]*)"\s*,\s*([\w.]+)`)
	phoenixActions   = []resourceAction{{"index", "GET", ""}, {"new", "GET", "new"}, {"create", "POST", ""}, {"show", "GET", "{member}"}, {"edit", "GET", "{member}/edit"}, {"update", "PATCH", "{member}"}, {"update", "PUT", "{member}"}, {"delete", "DELETE", "{member}"}}
)

// phoenixEndpoints reads a Phoenix router: scopes, verbs, live routes and resources with do-blocks.
func phoenixEndpoints(text string) []Endpoint {
	if !strings.Contains(text, "Phoenix.Router") && !strings.Contains(text, ":router") {
		return nil
	}
	var out []Endpoint
	var stack blockStack
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if trimmed == "end" {
			stack.pop()
			continue
		}
		frame := stack.top()
		child := frame
		for _, endpoint := range phoenixLine(trimmed, frame, &child) {
			endpoint.Line, endpoint.Language, endpoint.Framework = index+1, "elixir", "phoenix"
			out = append(out, endpoint)
		}
		if strings.HasSuffix(trimmed, " do") {
			stack.push(child)
		}
	}
	return out
}

func phoenixLine(line string, frame routeFrame, child *routeFrame) []Endpoint {
	if match := phoenixScope.FindStringSubmatch(line); match != nil {
		child.prefix = joinRoute(frame.prefix, match[1])
		return nil
	}
	if match := phoenixResources.FindStringSubmatch(line); match != nil {
		base := joinRoute(frame.prefix, match[1])
		child.prefix = joinRoute(base, ":"+singular(match[1])+"_id")
		endpoints := resourceRoutes(base, ":id", phoenixActions, filterActions(line))
		for index := range endpoints {
			endpoints[index].Handler = match[2] + "." + endpoints[index].Handler
		}
		return endpoints
	}
	match := phoenixVerb.FindStringSubmatch(line)
	if match == nil {
		return nil
	}
	method, handler := strings.ToUpper(match[1]), match[3]
	if method == "LIVE" {
		method = "GET"
	}
	if match[4] != "" {
		handler += "." + match[4]
	}
	return []Endpoint{{Method: method, Path: joinRoute(frame.prefix, match[2]), Handler: handler}}
}
