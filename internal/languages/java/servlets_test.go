package java

import "testing"

func TestServletRoutePath(t *testing.T) {
	for pattern, want := range map[string]string{"/orders/*": "/orders/**", "/": "/**", "/*": "/**", "*.do": "/{action}.do", "/health": "/health", "api": "/api"} {
		if got := ServletRoutePath(pattern); got != want {
			t.Errorf("ServletRoutePath(%q) = %q, want %q", pattern, got, want)
		}
	}
}

func TestWebXMLMappingsSurviveAMalformedTail(t *testing.T) {
	mappings := WebXMLMappings([]byte(`<web-app><servlet><servlet-name>a</servlet-name><jsp-file>/index.jsp</jsp-file></servlet>
<servlet-mapping><servlet-name>a</servlet-name><url-pattern>/home</url-pattern><url-pattern>/start</url-pattern></servlet-mapping><broken`))
	if len(mappings) != 2 || mappings[0].JSPFile != "/index.jsp" || mappings[1].Pattern != "/start" || mappings[0].Line != 2 {
		t.Fatalf("mappings = %+v", mappings)
	}
}
