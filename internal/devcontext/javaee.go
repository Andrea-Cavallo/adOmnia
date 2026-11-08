package devcontext

import (
	"maps"
	"path"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// earWebModuleKind is internal: a web module of an EAR and its context root, applied to the routes of that
// module at snapshot time.
const earWebModuleKind = "earwebmodule"

// jdbcTypes maps JDBC subprotocols to the datasource types the rest of adOmnia knows.
var jdbcTypes = map[string]string{"postgresql": "postgres", "pgsql": "postgres", "mysql": "mysql", "mariadb": "mysql"}

func isPersistenceXML(base string) bool { return base == "persistence.xml" }

func isEARDescriptor(rel string) bool {
	return path.Base(rel) == "application.xml" && path.Base(path.Dir(rel)) == "META-INF"
}

func isJSP(base string) bool {
	switch strings.ToLower(path.Ext(base)) {
	case ".jsp", ".jspx":
		return true
	}
	return false
}

// detectPersistenceXML: a persistence unit with a JDBC URL is a datasource (never with its password).
func detectPersistenceXML(rel string, data []byte) []Entity {
	var out []Entity
	for _, unit := range java.PersistenceUnits(data) {
		if unit.URL == "" {
			continue // a jta-data-source is a JNDI name: the server holds the connection
		}
		source := Source{"jpa", rel, unit.Line}
		if ds, ok := jdbcDatasource(unit.URL, unit.User, source); ok {
			ds.Attrs["persistenceUnit"], ds.Attrs["declFile"], ds.Attrs["declLine"] = unit.Name, rel, strconv.Itoa(unit.Line)
			out = append(out, ds)
		}
	}
	return out
}

func jdbcDatasource(url, user string, source Source) (Entity, bool) {
	database, ok := java.ParseJDBCURL(url)
	if !ok || database.Host == "" {
		return Entity{}, false // embedded databases have no server to connect to
	}
	typ := jdbcTypes[database.Vendor]
	if typ == "" {
		typ = database.Vendor
	}
	port := ""
	if database.Port > 0 {
		port = strconv.Itoa(database.Port)
	}
	return datasource(typ, database.Host, port, user, database.Database, ConfidenceCertain, source), true
}

// detectJPAEntities: an @Entity class is the table it maps, opened at the class.
func detectJPAEntities(rel string, data []byte) []Entity {
	var out []Entity
	for _, mapped := range java.JPAEntitiesInFile(rel, data) {
		attrs := map[string]string{"orm": "jpa", "declFile": rel, "declLine": strconv.Itoa(mapped.Line), "declName": mapped.Class, "language": "java"}
		out = append(out, entity("table", mapped.Table, mapped.Table, ConfidenceInferred, attrs, Source{"jpa", rel, mapped.Line}))
	}
	return out
}

// detectJSP: a page under a webapp folder answers GET at its path (pages under WEB-INF are not public).
func detectJSP(rel string) []Entity {
	page, ok := java.WebappPagePath(rel)
	if !ok {
		return nil
	}
	attrs := map[string]string{"declFile": rel, "declLine": "1", "declName": path.Base(rel), "page": "jsp"}
	return []Entity{routeEntity("GET", page, ConfidenceInferred, attrs, Source{"jsp", rel, 1})}
}

func detectEARDescriptor(rel string, data []byte) []Entity {
	var out []Entity
	for _, module := range java.EARWebModules(data) {
		root := normalizeContextPath(module.ContextRoot)
		if root == "" {
			continue
		}
		attrs := map[string]string{"uri": module.URI, "contextRoot": root, "file": rel}
		out = append(out, entity(earWebModuleKind, rel+":"+module.URI, module.URI, ConfidenceCertain, attrs, Source{"ear", rel, module.Line}))
	}
	return out
}

// linkEARContextRoots prefixes the routes of each web module of an EAR with its context root: a route
// belongs to the module whose folder name is the WAR name (billing.war, billing-1.0.war → billing/).
func linkEARContextRoots(entities []Entity) []Entity {
	var modules []Entity
	rest := make([]Entity, 0, len(entities))
	for _, e := range entities {
		if e.Kind == earWebModuleKind {
			modules = append(modules, e)
			continue
		}
		rest = append(rest, e)
	}
	if len(modules) == 0 {
		return rest
	}
	out := make([]Entity, 0, len(rest))
	for _, e := range rest {
		if e.Kind != "route" {
			out = append(out, e)
			continue
		}
		root := contextRootOf(e, modules)
		if root == "" || strings.HasPrefix(e.Attrs["path"], root+"/") || e.Attrs["path"] == root {
			out = append(out, e)
			continue
		}
		attrs := make(map[string]string, len(e.Attrs)+1)
		maps.Copy(attrs, e.Attrs)
		attrs["contextRoot"] = root
		moved := routeEntity(e.Attrs["method"], root+e.Attrs["path"], e.Confidence, attrs, e.Sources[0])
		moved.Sources = append([]Source(nil), e.Sources...)
		out = append(out, moved)
	}
	return merge(out)
}

func contextRootOf(route Entity, modules []Entity) string {
	file := route.Attrs["declFile"]
	if file == "" && len(route.Sources) > 0 {
		file = route.Sources[0].File
	}
	folder := path.Base(java.WebappModuleRoot(file))
	if folder == "" || folder == "." {
		return ""
	}
	for _, module := range modules {
		stem := strings.TrimSuffix(path.Base(module.Attrs["uri"]), ".war")
		if stem == folder || strings.HasPrefix(stem, folder+"-") {
			return module.Attrs["contextRoot"]
		}
	}
	return ""
}
