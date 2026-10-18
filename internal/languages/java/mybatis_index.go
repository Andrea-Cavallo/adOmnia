package java

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Indice MyBatis: collega i metodi di un'interfaccia mapper agli statement `<select|insert|update|delete id="…">`
// del suo XML (namespace = nome qualificato dell'interfaccia, id = nome del metodo). Solo analisi dei sorgenti.

// Limiti della scansione: un monorepo enorme non deve bloccare l'apertura del progetto.
const (
	maxMyBatisFiles    = 6_000
	maxMyBatisFileKB   = 512
	myBatisJavaOnly    = "javaOnly"
	myBatisXMLOnly     = "xmlOnly"
	myBatisBothSides   = "linked"
	myBatisAnnotations = "Select Insert Update Delete SelectProvider InsertProvider UpdateProvider DeleteProvider"
)

// MyBatisLink è uno statement con le sue due metà: il metodo dell'interfaccia e il nodo XML.
type MyBatisLink struct {
	Namespace string `json:"namespace"`
	ID        string `json:"id"`
	// Kind è select, insert, update o delete (dal tag XML; "" se esiste solo il metodo).
	Kind string `json:"kind,omitempty"`
	// State: linked (metodo e XML), xmlOnly (nessun metodo con quel nome), javaOnly (metodo senza statement).
	State string `json:"state"`

	XMLFile     string `json:"xmlFile,omitempty"`
	XMLLine     int    `json:"xmlLine,omitempty"`
	XMLStartCol int    `json:"xmlStartColumn,omitempty"`
	XMLEndCol   int    `json:"xmlEndColumn,omitempty"`

	JavaFile     string `json:"javaFile,omitempty"`
	JavaLine     int    `json:"javaLine,omitempty"`
	JavaStartCol int    `json:"javaStartColumn,omitempty"`
	JavaEndCol   int    `json:"javaEndColumn,omitempty"`
}

// MyBatisIndex è l'elenco dei collegamenti trovati, ordinato per namespace e id.
type MyBatisIndex struct {
	Links []MyBatisLink `json:"links"`
	// Skipped sono i file non letti per i limiti della scansione.
	Skipped int `json:"skipped,omitempty"`
}

var (
	mapperNamespace = regexp.MustCompile(`<mapper\b[^>]*\bnamespace\s*=\s*"([^"]+)"`)
	mapperStatement = regexp.MustCompile(`<(select|insert|update|delete)\b[^>]*?\bid\s*=\s*"([^"]+)"`)
)

type xmlStatement struct {
	namespace, id, kind, file string
	line, startCol, endCol    int
}

// BuildMyBatisIndex legge i mapper XML e le interfacce Java del progetto e li collega.
func BuildMyBatisIndex(projectRoot string) MyBatisIndex {
	javaFiles, xmlFiles, skipped := myBatisSources(projectRoot)
	var statements []xmlStatement
	for _, path := range xmlFiles {
		statements = append(statements, readMapperStatements(path, projectRoot)...)
	}
	namespaces := map[string]bool{}
	for _, statement := range statements {
		namespaces[statement.namespace] = true
	}

	type method struct {
		file                   string
		line, startCol, endCol int
		annotated              bool
	}
	methods := map[string]map[string]method{} // namespace → nome metodo
	for _, path := range javaFiles {
		source, ok := readJavaSource(path, projectRoot)
		if !ok {
			continue
		}
		for _, declared := range source.Types {
			if declared.Kind != "interface" || !namespaces[declared.Name] {
				continue
			}
			byName := map[string]method{}
			for _, member := range source.Members {
				if member.Kind != "method" || member.Class != declared.Name {
					continue
				}
				byName[member.Name] = method{file: source.File, line: member.Line, startCol: member.StartColumn, endCol: member.EndColumn, annotated: hasStatementAnnotation(member.Annotations)}
			}
			methods[declared.Name] = byName
		}
	}

	var links []MyBatisLink
	used := map[string]bool{}
	for _, statement := range statements {
		link := MyBatisLink{Namespace: statement.namespace, ID: statement.id, Kind: statement.kind, State: myBatisXMLOnly,
			XMLFile: statement.file, XMLLine: statement.line, XMLStartCol: statement.startCol, XMLEndCol: statement.endCol}
		if found, ok := methods[statement.namespace][statement.id]; ok {
			link.State, link.JavaFile, link.JavaLine, link.JavaStartCol, link.JavaEndCol = myBatisBothSides, found.file, found.line, found.startCol, found.endCol
			used[statement.namespace+"#"+statement.id] = true
		}
		links = append(links, link)
	}
	// Metodi di un mapper che l'XML conosce ma senza statement: né XML né annotation (@Select…) li esegue.
	for namespace, byName := range methods {
		for name, found := range byName {
			if used[namespace+"#"+name] || found.annotated {
				continue
			}
			links = append(links, MyBatisLink{Namespace: namespace, ID: name, State: myBatisJavaOnly, JavaFile: found.file, JavaLine: found.line, JavaStartCol: found.startCol, JavaEndCol: found.endCol})
		}
	}
	sort.SliceStable(links, func(i, j int) bool {
		if links[i].Namespace != links[j].Namespace {
			return links[i].Namespace < links[j].Namespace
		}
		return links[i].ID < links[j].ID
	})
	return MyBatisIndex{Links: links, Skipped: skipped}
}

func hasStatementAnnotation(annotations []javaAnnotation) bool {
	for _, annotation := range annotations {
		if strings.Contains(" "+myBatisAnnotations+" ", " "+annotation.Name+" ") {
			return true
		}
	}
	return false
}

func readMapperStatements(path, projectRoot string) []xmlStatement {
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxMyBatisFileKB<<10 {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	namespace := mapperNamespace.FindSubmatch(data)
	if namespace == nil {
		return nil
	}
	relative := relativeTo(projectRoot, path)
	text := string(data)
	var found []xmlStatement
	for _, match := range mapperStatement.FindAllStringSubmatchIndex(text, -1) {
		line, column := lineColumn(text, match[4])
		found = append(found, xmlStatement{
			namespace: string(namespace[1]), kind: text[match[2]:match[3]], id: text[match[4]:match[5]], file: relative,
			line: line, startCol: column, endCol: column + (match[5] - match[4]),
		})
	}
	return found
}

// lineColumn converte un offset di byte in riga e colonna (1-based).
func lineColumn(text string, offset int) (line, column int) {
	line = 1 + strings.Count(text[:offset], "\n")
	column = offset - (strings.LastIndex(text[:offset], "\n") + 1) + 1
	return line, column
}

// myBatisSources elenca i .java e i .xml sotto la radice, con gli stessi limiti dell'indice Spring.
func myBatisSources(projectRoot string) (javaFiles, xmlFiles []string, skipped int) {
	scanned := 0
	_ = filepath.WalkDir(projectRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != projectRoot && (ignoredDirectory(entry.Name()) || depth(projectRoot, path) > maxScanDepth+6) {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		isJava, isXML := strings.HasSuffix(name, ".java"), strings.HasSuffix(name, ".xml")
		if !isJava && !isXML {
			return nil
		}
		if scanned++; scanned > maxMyBatisFiles {
			skipped++
			return nil
		}
		if isJava {
			javaFiles = append(javaFiles, path)
		} else {
			xmlFiles = append(xmlFiles, path)
		}
		return nil
	})
	return javaFiles, xmlFiles, skipped
}
