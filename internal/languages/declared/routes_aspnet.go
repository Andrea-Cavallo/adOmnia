package declared

import (
	"regexp"
	"strings"
)

var (
	// app.MapGet("/x", …), group.MapPost(@"/x", …), app.MapMethods("/x", …)
	aspnetMap = regexp.MustCompile(`\b(\w+)\s*\.\s*Map(Get|Post|Put|Delete|Patch|Methods)\s*\(\s*@?"([^"]*)"`)
	// var api = app.MapGroup("/api");
	aspnetGroup = regexp.MustCompile(`\b(\w+)\s*=\s*(\w+)\s*\.\s*MapGroup\s*\(\s*@?"([^"]*)"`)
	// [Route("api/[controller]")]
	aspnetRoute = regexp.MustCompile(`\bRoute\s*\(\s*@?"([^"]*)"`)
	// [HttpGet], [HttpPost("{id}")], [HttpDelete(template: "x")]
	aspnetVerb   = regexp.MustCompile(`\bHttp(Get|Post|Put|Delete|Patch)\s*(?:\(\s*(?:template\s*:\s*)?@?"([^"]*)"[^)]*\))?`)
	aspnetClass  = regexp.MustCompile(`\bclass\s+(\w+)`)
	aspnetMember = regexp.MustCompile(`(\w+)\s*(?:<[^>]*>)?\s*\(`)
)

type aspnetVerbAttr struct{ method, route string }

// aspnetEndpoints reads minimal APIs (MapGet, MapGroup prefixes) and attribute-routed controllers.
func aspnetEndpoints(text string) []Endpoint {
	if !strings.Contains(text, "Map") && !strings.Contains(text, "Http") {
		return nil
	}
	var out []Endpoint
	groups := map[string]string{}
	var class, classRoute, pendingRoute string
	var pendingVerbs []aspnetVerbAttr
	for index, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") {
			continue
		}
		if match := aspnetGroup.FindStringSubmatch(trimmed); match != nil {
			groups[match[1]] = joinRoute(groups[match[2]], match[3])
		}
		for _, match := range aspnetMap.FindAllStringSubmatch(trimmed, -1) {
			method := strings.ToUpper(match[2])
			if method == "METHODS" {
				method = "ANY"
			}
			out = append(out, Endpoint{Method: method, Path: joinRoute(groups[match[1]], match[3]), Line: index + 1, Framework: "aspnet"})
		}
		if strings.HasPrefix(trimmed, "[") {
			if match := aspnetRoute.FindStringSubmatch(trimmed); match != nil {
				pendingRoute = match[1]
			}
			for _, match := range aspnetVerb.FindAllStringSubmatch(trimmed, -1) {
				pendingVerbs = append(pendingVerbs, aspnetVerbAttr{strings.ToUpper(match[1]), match[2]})
			}
			continue
		}
		if match := aspnetClass.FindStringSubmatch(trimmed); match != nil {
			class, classRoute, pendingRoute, pendingVerbs = match[1], pendingRoute, "", nil
			continue
		}
		if len(pendingVerbs) == 0 || !strings.Contains(trimmed, "(") {
			continue
		}
		member := ""
		if match := aspnetMember.FindStringSubmatch(trimmed); match != nil {
			member = match[1]
		}
		for _, verb := range pendingVerbs {
			out = append(out, aspnetAction(class, classRoute, pendingRoute, member, verb, index+1))
		}
		pendingRoute, pendingVerbs = "", nil
	}
	return out
}

// aspnetAction combines the controller route with the action route, as ASP.NET does: a template
// starting with "/" or "~/" ignores the controller route; [controller] and [action] are replaced.
func aspnetAction(class, classRoute, memberRoute, member string, verb aspnetVerbAttr, line int) Endpoint {
	route := verb.route
	if route == "" {
		route = memberRoute
	}
	full := joinRoute(classRoute, route)
	if strings.HasPrefix(route, "/") || strings.HasPrefix(route, "~/") {
		full = joinRoute("", strings.TrimPrefix(route, "~"))
	}
	full = strings.ReplaceAll(full, "[controller]", strings.TrimSuffix(class, "Controller"))
	full = strings.ReplaceAll(full, "[action]", member)
	return Endpoint{Method: verb.method, Path: full, Line: line, Handler: class + "." + member, Framework: "aspnet"}
}
