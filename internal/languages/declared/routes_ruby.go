package declared

import (
	"regexp"
	"strings"
)

var (
	// get '/users/:id', to: 'users#show' — get :search (inside a resource) — Sinatra: get '/x' do
	rubyVerb      = regexp.MustCompile(`^(get|post|put|patch|delete|options|match)\s*\(?\s*(?:['"]([^'"]*)['"]|:(\w+))`)
	rubyTo        = regexp.MustCompile(`(?:to:|=>)\s*['"]([\w/]+#\w+)['"]`)
	rubyVia       = regexp.MustCompile(`via:\s*\[?([^\]\n]*)`)
	rubyRoot      = regexp.MustCompile(`^root\b(?:\s*\(?\s*(?:to:\s*)?['"]([\w/]+#\w+)['"])?`)
	rubyNamespace = regexp.MustCompile(`^namespace\s*\(?\s*:(\w+)`)
	rubyScope     = regexp.MustCompile(`^scope\s*\(?\s*(?:path:\s*)?['"]([^'"]*)['"]`)
	rubyResources = regexp.MustCompile(`^(resources?)\s*\(?\s*:(\w+)`)
	rubyOpener    = regexp.MustCompile(`^(if|unless|def|class|module|begin|case|while|until|for)\b`)
	railsActions  = []resourceAction{{"index", "GET", ""}, {"new", "GET", "new"}, {"create", "POST", ""}, {"show", "GET", "{member}"}, {"edit", "GET", "{member}/edit"}, {"update", "PATCH", "{member}"}, {"update", "PUT", "{member}"}, {"destroy", "DELETE", "{member}"}}
)

// rubyEndpoints reads Rails config/routes.rb (namespace, scope, resources, member/collection) and
// Sinatra apps. Other Ruby files are skipped: RSpec request specs also call `get '/x'`.
func rubyEndpoints(rel, text string) []Endpoint {
	slashed := strings.ReplaceAll(rel, "\\", "/")
	rails := strings.HasSuffix(slashed, "config/routes.rb") || strings.Contains(slashed, "config/routes/")
	framework := "rails"
	if !rails {
		if !strings.Contains(strings.ToLower(text), "sinatra") {
			return nil
		}
		framework = "sinatra"
	}
	var out []Endpoint
	var stack blockStack
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if trimmed == "end" || strings.HasPrefix(trimmed, "end ") || strings.HasPrefix(trimmed, "end.") {
			stack.pop()
			continue
		}
		frame := stack.top()
		child := frame
		for _, endpoint := range rubyLine(trimmed, frame, &child) {
			endpoint.Line, endpoint.Language, endpoint.Framework = index+1, "ruby", framework
			endpoint.Path = cleanParams(endpoint.Path)
			out = append(out, endpoint)
		}
		if opensRubyBlock(trimmed) {
			stack.push(child)
		}
	}
	return out
}

func opensRubyBlock(line string) bool {
	return strings.HasSuffix(line, " do") || strings.Contains(line, " do |") || rubyOpener.MatchString(line)
}

// rubyLine returns the routes of one line and sets child to the frame its do-block opens.
func rubyLine(line string, frame routeFrame, child *routeFrame) []Endpoint {
	switch {
	case line == "member do" || strings.HasPrefix(line, "member do"):
		child.prefix = joinRoute(frame.resource, ":id")
	case line == "collection do" || strings.HasPrefix(line, "collection do"):
		child.prefix = frame.resource
	}
	if match := rubyNamespace.FindStringSubmatch(line); match != nil {
		child.prefix = joinRoute(frame.prefix, match[1])
		return nil
	}
	if match := rubyScope.FindStringSubmatch(line); match != nil {
		child.prefix = joinRoute(frame.prefix, match[1])
		return nil
	}
	if match := rubyRoot.FindStringSubmatch(line); match != nil {
		return []Endpoint{{Method: "GET", Path: joinRoute(frame.prefix, ""), Handler: match[1]}}
	}
	if match := rubyResources.FindStringSubmatch(line); match != nil {
		base := joinRoute(frame.prefix, match[2])
		member, keep := ":id", filterActions(line)
		if match[1] == "resource" { // singular: no index, no :id
			member = ""
			inner := keep
			keep = func(action string) bool { return action != "index" && (inner == nil || inner(action)) }
		}
		*child = routeFrame{prefix: joinRoute(base, ":"+singular(match[2])+"_id"), resource: base}
		if member == "" {
			child.prefix = base
		}
		endpoints := resourceRoutes(base, member, railsActions, keep)
		for index := range endpoints {
			endpoints[index].Handler = match[2] + "#" + endpoints[index].Handler
		}
		return endpoints
	}
	match := rubyVerb.FindStringSubmatch(line)
	if match == nil {
		return nil
	}
	route := match[2]
	if route == "" {
		route = match[3]
	}
	handler := ""
	if to := rubyTo.FindStringSubmatch(line); to != nil {
		handler = to[1]
	}
	if match[1] != "match" {
		return []Endpoint{{Method: strings.ToUpper(match[1]), Path: joinRoute(frame.prefix, route), Handler: handler}}
	}
	var out []Endpoint
	if via := rubyVia.FindStringSubmatch(line); via != nil {
		for _, method := range actionName.FindAllString(via[1], -1) {
			if method == "all" {
				continue
			}
			out = append(out, Endpoint{Method: strings.ToUpper(method), Path: joinRoute(frame.prefix, route), Handler: handler})
		}
	}
	if len(out) == 0 {
		out = append(out, Endpoint{Method: "ANY", Path: joinRoute(frame.prefix, route), Handler: handler})
	}
	return out
}
