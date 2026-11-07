package java

import (
	"bytes"
	"encoding/xml"
	"path"
	"strings"
)

// PersistenceUnit is a <persistence-unit> of META-INF/persistence.xml.
type PersistenceUnit struct {
	Name string `json:"name"`
	Line int    `json:"line"`
	// DataSource is the JNDI name the server provides (jta-data-source, else non-jta-data-source).
	DataSource string `json:"dataSource,omitempty"`
	// URL and User come from the JDBC properties (javax/jakarta.persistence.jdbc.*, Hibernate, EclipseLink, OpenJPA).
	URL  string `json:"url,omitempty"`
	User string `json:"user,omitempty"`
}

// JDBCDatabase is a JDBC URL read as a connection target. Vendor is the JDBC subprotocol (postgresql,
// mysql, oracle…); Host is empty for embedded databases.
type JDBCDatabase struct {
	Vendor   string
	Host     string
	Port     int
	Database string
}

// JPAEntity is an @Entity class and the table it maps.
type JPAEntity struct {
	Class string `json:"class"`
	Table string `json:"table"`
	File  string `json:"file"`
	Line  int    `json:"line"`
}

var (
	jdbcURLProperties  = []string{"javax.persistence.jdbc.url", "jakarta.persistence.jdbc.url", "hibernate.connection.url", "eclipselink.jdbc.url", "openjpa.ConnectionURL"}
	jdbcUserProperties = []string{"javax.persistence.jdbc.user", "jakarta.persistence.jdbc.user", "hibernate.connection.username", "eclipselink.jdbc.user", "openjpa.ConnectionUserName"}
)

// PersistenceUnits reads persistence.xml; a malformed file yields the units read before the error.
func PersistenceUnits(data []byte) []PersistenceUnit {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	var units []PersistenceUnit
	for {
		offset := decoder.InputOffset()
		token, err := decoder.Token()
		if err != nil {
			return units // io.EOF or a malformed tail
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "persistence-unit" {
			continue
		}
		var unit struct {
			Name       string `xml:"name,attr"`
			JTA        string `xml:"jta-data-source"`
			NonJTA     string `xml:"non-jta-data-source"`
			Properties []struct {
				Name  string `xml:"name,attr"`
				Value string `xml:"value,attr"`
			} `xml:"properties>property"`
		}
		if decoder.DecodeElement(&unit, &start) != nil {
			return units
		}
		properties := map[string]string{}
		for _, property := range unit.Properties {
			properties[property.Name] = strings.TrimSpace(property.Value)
		}
		dataSource := strings.TrimSpace(unit.JTA)
		if dataSource == "" {
			dataSource = strings.TrimSpace(unit.NonJTA)
		}
		units = append(units, PersistenceUnit{
			Name: unit.Name, Line: 1 + bytes.Count(data[:offset], []byte("\n")), DataSource: dataSource,
			URL: firstProperty(properties, jdbcURLProperties), User: firstProperty(properties, jdbcUserProperties),
		})
	}
}

func firstProperty(properties map[string]string, names []string) string {
	for _, name := range names {
		if value := properties[name]; value != "" {
			return value
		}
	}
	return ""
}

// ParseJDBCURL reads a JDBC URL (PostgreSQL, MySQL, Oracle thin, SQL Server, embedded databases…).
func ParseJDBCURL(raw string) (JDBCDatabase, bool) {
	target, ok := parseJdbcURL(raw)
	if !ok {
		return JDBCDatabase{}, false
	}
	return JDBCDatabase{Vendor: target.vendor, Host: target.host, Port: target.port, Database: target.database}, true
}

// JPAEntitiesInFile finds the @Entity classes of one source and their table: @Table(name), else the entity
// name (@Entity(name), else the class name), the JPA default.
func JPAEntitiesInFile(relativePath string, data []byte) []JPAEntity {
	if !bytes.Contains(data, []byte("Entity")) {
		return nil
	}
	source := parseJavaSource(data)
	var entities []JPAEntity
	for _, decl := range source.Types {
		annotation := findAnnotation(decl.Annotations, "Entity")
		if annotation == nil || decl.Kind != "class" {
			continue
		}
		table := decl.Short
		if name := annotationString(annotation.Args, "name"); name != "" {
			table = name
		}
		if tableAnnotation := findAnnotation(decl.Annotations, "Table"); tableAnnotation != nil {
			if name := annotationString(tableAnnotation.Args, "name"); name != "" {
				table = name
			}
			if schema := annotationString(tableAnnotation.Args, "schema"); schema != "" {
				table = schema + "." + table
			}
		}
		entities = append(entities, JPAEntity{Class: decl.Name, Table: table, File: relativePath, Line: decl.Line})
	}
	return entities
}

// EARWebModule is a web module of an enterprise application (META-INF/application.xml).
type EARWebModule struct {
	URI         string `json:"uri"` // billing.war
	ContextRoot string `json:"contextRoot"`
	Line        int    `json:"line"`
}

// EARWebModules reads the web modules of application.xml.
func EARWebModules(data []byte) []EARWebModule {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	var modules []EARWebModule
	for {
		offset := decoder.InputOffset()
		token, err := decoder.Token()
		if err != nil {
			return modules
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "web" {
			continue
		}
		var web struct {
			URI         string `xml:"web-uri"`
			ContextRoot string `xml:"context-root"`
		}
		if decoder.DecodeElement(&web, &start) != nil {
			return modules
		}
		if uri := strings.TrimSpace(web.URI); uri != "" {
			modules = append(modules, EARWebModule{URI: uri, ContextRoot: strings.TrimSpace(web.ContextRoot), Line: 1 + bytes.Count(data[:offset], []byte("\n"))})
		}
	}
}

// WebappPagePath is the URL of a page (JSP, HTML) under a webapp folder of the usual layouts, or false
// for files outside one and under WEB-INF/META-INF, which clients cannot request.
func WebappPagePath(relativePath string) (string, bool) {
	slashed, index, marker := firstMarker(relativePath, webappCandidates)
	if index < 0 {
		return "", false
	}
	page := "/" + slashed[index+len(marker):]
	if strings.HasPrefix(page, "/WEB-INF/") || strings.HasPrefix(page, "/META-INF/") {
		return "", false
	}
	return page, true
}

// WebappModuleRoot is the module folder of a file in a webapp or Java source layout (the part before
// WebContent/, src/…), "" when unknown. EAR context roots apply to every route below it.
func WebappModuleRoot(relativePath string) string {
	slashed, index, _ := firstMarker(relativePath, append(append([]string{}, webappCandidates...), "src", "JavaSource"))
	if index < 0 {
		return ""
	}
	return strings.TrimPrefix(slashed[:index], "/")
}

// firstMarker finds the layout folder that comes first in the path: `web` is also a package name
// (com/acme/web), so the outermost folder wins, not the first name of the list.
func firstMarker(relativePath string, markers []string) (slashed string, index int, marker string) {
	slashed = "/" + strings.TrimPrefix(path.Clean("/"+relativePath), "/")
	index = -1
	for _, candidate := range markers {
		folder := "/" + candidate + "/"
		if at := strings.Index(slashed, folder); at >= 0 && (index < 0 || at < index) {
			index, marker = at, folder
		}
	}
	return slashed, index, marker
}
