package flowintel

import (
	"os"
	"regexp"
	"strings"
)

// A small, dependency-free Java reader: enough for legacy workspaces where JDT is not
// available for every bundle. It reads package/types/methods/annotations and the calls in
// method bodies. It never claims compilation-level precision: the caller marks unresolved
// calls as inferred.

type javaType struct {
	FQN         string
	Name        string
	Package     string
	File        string
	Line        int
	Kind        string // class, interface, enum
	Annotations []string
	Imports     []string
}

type javaMethod struct {
	ID          string
	Name        string
	Class       string // FQN
	File        string
	Line        int
	Annotations []string
	Calls       []javaCall
	Externals   []External
}

type javaCall struct {
	Receiver string
	Name     string
	Line     int
}

type javaFile struct {
	Types   []javaType
	Methods []javaMethod
	Imports []string
}

var (
	javaPackagePattern = regexp.MustCompile(`(?m)^\s*package\s+([\w.]+)\s*;`)
	javaTypePattern    = regexp.MustCompile(`\b(class|interface|enum)\s+([A-Za-z_$][\w$]*)`)
	javaMethodPattern  = regexp.MustCompile(`(?m)^[\t ]*(?:(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default)\s+)*(?:<[^>\n]+>\s*)?([\w$.<>\[\],? ]+?)\s+([A-Za-z_$][\w$]*)\s*\(([^)\n]*)\)\s*(?:throws[^{\n]+)?\{`)
	javaCallPattern    = regexp.MustCompile(`(?:(?P<receiver>[A-Za-z_$][\w$]*)\s*\.\s*)?(?P<name>[A-Za-z_$][\w$]*)\s*\(`)
	javaAnnotation     = regexp.MustCompile(`@([A-Za-z_$][\w$.]*)`)
	javaImportPattern  = regexp.MustCompile(`(?m)^\s*import\s+(?:static\s+)?([\w.*]+)\s*;`)
)

// javaKeywords are never method calls.
var javaKeywords = map[string]bool{
	"if": true, "for": true, "while": true, "switch": true, "catch": true, "synchronized": true,
	"return": true, "new": true, "throw": true, "assert": true, "super": true, "this": true,
	"case": true, "do": true, "else": true, "try": true, "finally": true,
}

// readJavaFile parses one source file. rel is the project-relative path used in nodes.
func readJavaFile(path, rel string) (javaFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return javaFile{}, err
	}
	source := string(raw)
	stripped := stripJava(source)
	parsed := javaFile{}
	for _, match := range javaImportPattern.FindAllStringSubmatch(stripped, -1) {
		parsed.Imports = append(parsed.Imports, match[1])
	}
	packageName := ""
	if match := javaPackagePattern.FindStringSubmatch(stripped); len(match) == 2 {
		packageName = match[1]
	}
	lineStarts := lineIndex(stripped)

	// Types: each declaration carries the annotations immediately above it.
	typeLocation := map[string]int{}
	for _, match := range javaTypePattern.FindAllStringSubmatchIndex(stripped, -1) {
		kind, name := stripped[match[2]:match[3]], stripped[match[4]:match[5]]
		offset := match[0]
		fqn := name
		if packageName != "" {
			fqn = packageName + "." + name
		}
		parsed.Types = append(parsed.Types, javaType{
			FQN: fqn, Name: name, Package: packageName, File: rel,
			Line: lineAt(lineStarts, offset), Kind: kind,
			Annotations: annotationsBefore(stripped, offset, lineStarts),
			Imports:     parsed.Imports,
		})
		typeLocation[fqn] = offset
	}
	// The file's type is the last declared top-level type when the package has several.
	primary := ""
	if len(parsed.Types) > 0 {
		primary = parsed.Types[len(parsed.Types)-1].FQN
	}
	if primary == "" {
		return parsed, nil
	}

	for _, match := range javaMethodPattern.FindAllStringSubmatchIndex(stripped, -1) {
		returnType := strings.TrimSpace(stripped[match[2]:match[3]])
		name := stripped[match[4]:match[5]]
		if name == "" || javaKeywords[strings.ToLower(name)] || returnType == "" {
			continue
		}
		// A constructor has no return type before the name; the regex requires one, so this
		// skips `Foo(` and keeps `Foo method(`.
		// The match ends with the opening brace of the body.
		bodyStart := match[1] - 1
		if bodyStart < 0 || stripped[bodyStart] != '{' {
			continue
		}
		bodyEnd := matchingBrace(stripped, bodyStart)
		body := ""
		if bodyEnd > bodyStart {
			body = stripped[bodyStart:bodyEnd]
		}
		owner := primary
		// Attribute the method to the nearest type declared before it.
		for fqn, offset := range typeLocation {
			if offset < match[0] && (owner == "" || offset > typeLocation[owner]) {
				owner = fqn
			}
		}
		method := javaMethod{
			ID: "method:" + owner + "." + name, Name: name, Class: owner, File: rel,
			Line:        lineAt(lineStarts, match[0]),
			Annotations: annotationsBefore(stripped, match[0], lineStarts),
			Externals:   externalsFor(rel, parsed.Imports, annotationsBefore(stripped, match[0], lineStarts)),
		}
		for _, call := range javaCallPattern.FindAllStringSubmatchIndex(body, -1) {
			receiver := ""
			if call[2] >= 0 {
				receiver = body[call[2]:call[3]]
			}
			called := body[call[4]:call[5]]
			if javaKeywords[strings.ToLower(called)] || javaKeywords[strings.ToLower(receiver)] {
				continue
			}
			// `new Foo(` is a constructor use, not a method call.
			callOffset := call[0]
			if callOffset >= 3 && strings.HasSuffix(strings.TrimSpace(body[:callOffset]), "new") {
				continue
			}
			method.Calls = append(method.Calls, javaCall{Receiver: receiver, Name: called, Line: lineAt(lineStarts, bodyStart+callOffset)})
		}
		parsed.Methods = append(parsed.Methods, method)
	}
	return parsed, nil
}

// externalsFor maps imports and annotations to the external systems they imply.
func externalsFor(rel string, imports, annotations []string) []External {
	joinedImports := strings.Join(imports, " ")
	joinedAnnotations := strings.Join(annotations, " ")
	var externals []External
	add := func(kind, name, detail string) {
		for _, existing := range externals {
			if existing.Kind == kind && existing.Name == name {
				return
			}
		}
		externals = append(externals, External{Kind: kind, Name: name, Detail: detail})
	}
	switch {
	case strings.Contains(joinedImports, "javax.jws") || strings.Contains(joinedImports, "jakarta.jws") ||
		strings.Contains(joinedImports, "javax.xml.ws") || strings.Contains(joinedAnnotations, "WebService"):
		add("soap", "SOAP endpoint", "javax.jws / javax.xml.ws")
	case strings.Contains(joinedImports, "javax.ws.rs") || strings.Contains(joinedImports, "jakarta.ws.rs") ||
		strings.Contains(joinedImports, "org.springframework.web") || strings.Contains(joinedAnnotations, "RequestMapping") ||
		strings.Contains(joinedAnnotations, "GetMapping") || strings.Contains(joinedAnnotations, "PostMapping") ||
		strings.Contains(joinedAnnotations, "Path"):
		add("rest", "HTTP endpoint", "JAX-RS / Spring MVC")
	}
	if strings.Contains(joinedImports, "java.sql") || strings.Contains(joinedImports, "javax.sql") ||
		strings.Contains(joinedImports, "javax.persistence") || strings.Contains(joinedImports, "org.springframework.jdbc") ||
		strings.Contains(joinedImports, "org.hibernate") {
		add("database", "Database", "JDBC / JPA")
	}
	if strings.Contains(joinedImports, "javax.jms") || strings.Contains(joinedImports, "jakarta.jms") ||
		strings.Contains(joinedImports, "org.springframework.amqp") || strings.Contains(joinedImports, "org.apache.kafka") {
		add("async", "Message broker", "JMS / AMQP / Kafka")
	}
	_ = rel
	return externals
}

// annotationsBefore collects the annotations between the previous member boundary and offset.
func annotationsBefore(stripped string, offset int, lineStarts []int) []string {
	start := offset
	for start > 0 {
		previous := stripped[start-1]
		if previous == ';' || previous == '}' || previous == '{' {
			break
		}
		start--
	}
	segment := stripped[start:offset]
	var annotations []string
	for _, match := range javaAnnotation.FindAllStringSubmatch(segment, -1) {
		annotations = append(annotations, match[1])
	}
	_ = lineStarts
	return annotations
}

// stripJava blanks comments and string/char literals, preserving offsets and newlines.
func stripJava(source string) string {
	out := []byte(source)
	index := 0
	for index < len(out) {
		switch {
		case out[index] == '/' && index+1 < len(out) && out[index+1] == '/':
			for index < len(out) && out[index] != '\n' {
				out[index] = ' '
				index++
			}
		case out[index] == '/' && index+1 < len(out) && out[index+1] == '*':
			out[index], out[index+1] = ' ', ' '
			index += 2
			for index < len(out) {
				if out[index] == '*' && index+1 < len(out) && out[index+1] == '/' {
					out[index], out[index+1] = ' ', ' '
					index += 2
					break
				}
				if out[index] != '\n' {
					out[index] = ' '
				}
				index++
			}
		case out[index] == '"':
			out[index] = ' '
			index++
			for index < len(out) {
				if out[index] == '\\' && index+1 < len(out) {
					if out[index+1] != '\n' {
						out[index] = ' '
					}
					out[index+1] = ' '
					index += 2
					continue
				}
				if out[index] == '"' {
					out[index] = ' '
					index++
					break
				}
				if out[index] != '\n' {
					out[index] = ' '
				}
				index++
			}
		case out[index] == '\'':
			out[index] = ' '
			index++
			for index < len(out) {
				if out[index] == '\\' && index+1 < len(out) {
					out[index], out[index+1] = ' ', ' '
					index += 2
					continue
				}
				if out[index] == '\'' {
					out[index] = ' '
					index++
					break
				}
				if out[index] != '\n' {
					out[index] = ' '
				}
				index++
			}
		default:
			index++
		}
	}
	return string(out)
}

// matchingBrace returns the offset of the `}` matching the `{` at start.
func matchingBrace(source string, start int) int {
	depth := 0
	for index := start; index < len(source); index++ {
		switch source[index] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return index
			}
		}
	}
	return -1
}

// lineIndex returns the offsets where each line starts (1-based line numbers).
func lineIndex(source string) []int {
	starts := []int{0}
	for index := 0; index < len(source); index++ {
		if source[index] == '\n' {
			starts = append(starts, index+1)
		}
	}
	return starts
}

// lineAt converts a byte offset to a 1-based line.
func lineAt(starts []int, offset int) int {
	low, high := 0, len(starts)-1
	for low < high {
		mid := (low + high + 1) / 2
		if starts[mid] <= offset {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return low + 1
}
