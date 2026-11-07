package devcontext

import (
	"sort"
	"strings"
	"testing"
)

const orderServlet = `package com.acme.web;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class OrderServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) {}

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) {}

    private void doGet(String notAHandler) {}
}
`

const annotatedServlet = `package com.acme.web;

import jakarta.servlet.annotation.WebServlet;

@WebServlet(name = "health", urlPatterns = {"/health", "/status/*"})
public class HealthServlet extends BaseServlet {
    protected void doGet(HttpServletRequest req, HttpServletResponse res) {}
}
`

const legacyWebXML = `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
  <servlet-mapping>
    <servlet-name>orders</servlet-name>
    <url-pattern>/orders/*</url-pattern>
  </servlet-mapping>
  <servlet>
    <servlet-name>orders</servlet-name>
    <servlet-class>com.acme.web.OrderServlet</servlet-class>
  </servlet>
  <servlet>
    <servlet-name>struts</servlet-name>
    <servlet-class>com.vendor.LegacyActionServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>struts</servlet-name>
    <url-pattern>*.do</url-pattern>
  </servlet-mapping>
  <servlet>
    <servlet-name>spring</servlet-name>
    <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>spring</servlet-name>
    <url-pattern>/</url-pattern>
  </servlet-mapping>
</web-app>
`

func servletSnapshot(t *testing.T, files map[string]string) map[string]Entity {
	t.Helper()
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	var groups [][]Entity
	for _, name := range names {
		entities, _ := detectFile(name, []byte(files[name]), nil, AdapterHints{})
		groups = append(groups, entities)
	}
	byID := map[string]Entity{}
	for _, e := range linkHandlers(linkServlets(merge(groups...))) {
		if e.Kind == servletClassKind || e.Kind == servletMappingKind {
			t.Fatalf("internal entity leaked into the snapshot: %+v", e)
		}
		byID[e.ID] = e
	}
	return byID
}

func TestWebXMLMappingsBecomeRoutesAtTheServletMethods(t *testing.T) {
	routes := servletSnapshot(t, map[string]string{
		"src/main/webapp/WEB-INF/web.xml":               legacyWebXML,
		"src/main/java/com/acme/web/OrderServlet.java":  orderServlet,
		"src/main/java/com/acme/web/HealthServlet.java": annotatedServlet,
	})
	get, ok := routes["route:GET /orders/**"]
	if !ok || routes["route:POST /orders/**"].ID == "" || len(routes) != 5 {
		t.Fatalf("routes = %v", routeIDs(routes))
	}
	if get.Attrs["declName"] != "com.acme.web.OrderServlet.doGet" || get.Attrs["declLine"] != "9" || !strings.HasSuffix(get.Attrs["declFile"], "OrderServlet.java") || get.Attrs["servletPattern"] != "/orders/*" {
		t.Fatalf("the route opens doGet: %+v", get.Attrs)
	}
	if get.Sources[0].File != "src/main/webapp/WEB-INF/web.xml" || get.Confidence != ConfidenceCertain {
		t.Fatalf("the route comes from web.xml: %+v", get)
	}
	if action := routes["route:ANY /{action}.do"]; action.Attrs["declFile"] != "src/main/webapp/WEB-INF/web.xml" || action.Attrs["declName"] != "com.vendor.LegacyActionServlet" {
		t.Fatalf("a servlet from a jar points at web.xml: %+v", action)
	}
	if _, ok := routes["route:ANY /**"]; ok {
		t.Fatal("DispatcherServlet is not an endpoint")
	}
	if routes["route:GET /health"].ID == "" || routes["route:GET /status/**"].ID == "" {
		t.Fatalf("@WebServlet patterns are routes even without web.xml: %v", routeIDs(routes))
	}
}

func TestServletWithoutMappingHasNoRoute(t *testing.T) {
	if routes := servletSnapshot(t, map[string]string{"OrderServlet.java": orderServlet}); len(routes) != 0 {
		t.Fatalf("without a URL a servlet is not a route: %v", routeIDs(routes))
	}
}

func routeIDs(entities map[string]Entity) []string {
	out := make([]string, 0, len(entities))
	for key := range entities {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
