package java

import (
	"regexp"
	"strings"
)

// Annotation Spring riconosciute: sono loro a dire "questo è un bean", "qui si inietta", "qui risponde".
var (
	stereotypeAnnotations = map[string]string{
		"Component": "component", "Service": "service", "Repository": "repository",
		"Controller": "controller", "RestController": "controller", "Configuration": "configuration",
	}
	injectAnnotations   = map[string]bool{"Autowired": true, "Inject": true, "Resource": true}
	endpointAnnotations = map[string]bool{
		"RequestMapping": true, "GetMapping": true, "PostMapping": true, "PutMapping": true,
		"DeleteMapping": true, "PatchMapping": true,
	}
	httpMethodOf = map[string]string{
		"GetMapping": "GET", "PostMapping": "POST", "PutMapping": "PUT",
		"DeleteMapping": "DELETE", "PatchMapping": "PATCH",
	}
)

// projectProperties sono le proprietà dichiarate dalle classi `@ConfigurationProperties` del progetto.
// Sono le uniche proprietà con una posizione Java navigabile.
func projectProperties(source javaSource) []SpringProperty {
	var properties []SpringProperty
	seen := map[string]bool{}
	for _, decl := range source.Types {
		annotation := findAnnotation(decl.Annotations, "ConfigurationProperties")
		if annotation == nil {
			continue
		}
		prefix := strings.Trim(annotationString(annotation.Args, "prefix", "value", "path"), ".")
		for _, property := range configurationProperties(source, decl, prefix) {
			if seen[property.Name] {
				continue
			}
			seen[property.Name] = true
			properties = append(properties, property)
		}
	}
	return properties
}

// configurationProperties derivale proprietà da campi, record component e setter della classe.
func configurationProperties(source javaSource, decl javaTypeDecl, prefix string) []SpringProperty {
	var properties []SpringProperty
	add := func(name, typ, description string, line, startColumn, endColumn int) {
		key := name
		if prefix != "" {
			key = prefix + "." + name
		}
		properties = append(properties, SpringProperty{
			Name: key, Type: typ, Description: description, Source: SourceProject,
			Origin: decl.Name, File: source.File, Line: line, StartColumn: startColumn, EndColumn: endColumn,
		})
	}
	for _, component := range decl.Components {
		add(kebabCase(component.Name), component.Type, "", decl.Line, decl.StartColumn, decl.EndColumn)
	}
	for _, member := range source.Members {
		if member.Class != decl.Name {
			continue
		}
		switch {
		case member.Kind == "field":
			add(kebabCase(member.Name), member.Type, "", member.Line, member.StartColumn, member.EndColumn)
		case member.Kind == "method" && strings.HasPrefix(member.Name, "set") && len(member.Params) == 1:
			add(kebabCase(strings.TrimPrefix(member.Name, "set")), member.Params[0].Type, "", member.Line, member.StartColumn, member.EndColumn)
		}
	}
	return properties
}

// propertyReferencesOf sono i `@Value("${…}")` del progetto.
func propertyReferencesOf(sources []javaSource) []SpringPropertyReference {
	var references []SpringPropertyReference
	for _, source := range sources {
		for _, member := range source.Members {
			for _, annotation := range member.Annotations {
				if annotation.Name != "Value" {
					continue
				}
				for _, expression := range annotationStrings(annotation.Args) {
					key, fallback := propertyKey(expression)
					if key == "" {
						continue
					}
					references = append(references, SpringPropertyReference{
						Expression: expression, Key: key, Default: fallback,
						Class: member.Class, Member: member.Name, File: source.File,
						Line: annotation.Line, StartColumn: annotation.StartColumn, EndColumn: annotation.EndColumn,
					})
				}
			}
		}
	}
	return references
}

// beansOf sono i bean dichiarati dagli stereotype e dai metodi `@Bean`.
func beansOf(sources []javaSource) []SpringBean {
	var beans []SpringBean
	for _, source := range sources {
		for _, decl := range source.Types {
			annotation := findStereotype(decl.Annotations)
			if annotation == nil {
				continue
			}
			name := beanName(annotation, decl.Short)
			beans = append(beans, SpringBean{
				Name: name, Type: decl.Name, Kind: stereotypeAnnotations[annotation.Name],
				Scope: annotationString(annotation.Args, "scope"), Qualifiers: qualifiersOf(decl.Annotations),
				Class: decl.Name, File: source.File, Line: decl.Line, StartColumn: decl.StartColumn, EndColumn: decl.EndColumn,
			})
			for _, member := range source.Members {
				if member.Class != decl.Name || member.Kind != "method" {
					continue
				}
				bean := findAnnotation(member.Annotations, "Bean")
				if bean == nil {
					continue
				}
				beans = append(beans, SpringBean{
					Name: beanName(bean, member.Name), Type: cleanType(member.Type), Kind: "bean",
					Scope: annotationString(bean.Args, "scope"), Qualifiers: qualifiersOf(member.Annotations),
					Class: member.Class, Member: member.Name, File: source.File,
					Line: member.Line, StartColumn: member.StartColumn, EndColumn: member.EndColumn,
				})
			}
		}
	}
	return beans
}

// injectionsOf sono i punti di iniezione: campi annotati, parametri dei costruttori e setter.
func injectionsOf(sources []javaSource) []SpringInjection {
	var injections []SpringInjection
	for _, source := range sources {
		for _, member := range source.Members {
			annotation := findInject(member.Annotations)
			switch {
			case annotation != nil && member.Kind == "field":
				injections = append(injections, SpringInjection{
					Kind: "field", Type: cleanType(member.Type), Name: member.Name,
					Qualifier: qualifierOf(member.Annotations), Required: requiredOf(annotation),
					Class: member.Class, File: source.File,
					Line: member.Line, StartColumn: member.StartColumn, EndColumn: member.EndColumn,
				})
			case annotation != nil && member.Kind == "method" && strings.HasPrefix(member.Name, "set") && len(member.Params) == 1:
				injections = append(injections, SpringInjection{
					Kind: "setter", Type: cleanType(member.Params[0].Type), Name: member.Name,
					Qualifier: qualifierOf(member.Annotations), Required: requiredOf(annotation),
					Class: member.Class, File: source.File,
					Line: member.Line, StartColumn: member.StartColumn, EndColumn: member.EndColumn,
				})
			case member.Kind == "constructor":
				for _, param := range member.Params {
					injections = append(injections, SpringInjection{
						Kind: "parameter", Type: cleanType(param.Type), Name: param.Name,
						Qualifier: qualifierOf(param.Annotations), Required: true,
						Class: member.Class, File: source.File,
						Line: member.Line, StartColumn: member.StartColumn, EndColumn: member.EndColumn,
					})
				}
			}
		}
	}
	return injections
}

// endpointsOf sono gli endpoint MVC: la route completa è il percorso della classe più quello del metodo.
func endpointsOf(sources []javaSource) []SpringEndpoint {
	var endpoints []SpringEndpoint
	for _, source := range sources {
		for _, decl := range source.Types {
			base := ""
			for _, annotation := range decl.Annotations {
				if annotation.Name == "RequestMapping" {
					base = annotationPath(annotation.Args)
				}
			}
			for _, member := range source.Members {
				if member.Class != decl.Name || member.Kind != "method" {
					continue
				}
				annotation := findEndpoint(member.Annotations)
				if annotation == nil {
					continue
				}
				method := httpMethodOf[annotation.Name]
				if method == "" {
					method = strings.ToUpper(annotationString(annotation.Args, "method"))
					method = strings.TrimPrefix(method, "REQUESTMETHOD.")
				}
				endpoints = append(endpoints, SpringEndpoint{
					Method: method, Path: joinPath(base, annotationPath(annotation.Args)),
					Class: decl.Name, Member: member.Name, File: source.File,
					Produces: annotationString(annotation.Args, "produces"), Consumes: annotationString(annotation.Args, "consumes"),
					Line: annotation.Line, StartColumn: annotation.StartColumn, EndColumn: annotation.EndColumn,
				})
			}
		}
	}
	return endpoints
}

// findAnnotation è la prima annotation con uno dei nomi cercati.
func findAnnotation(annotations []javaAnnotation, name string) *javaAnnotation {
	for index := range annotations {
		if annotations[index].Name == name {
			return &annotations[index]
		}
	}
	return nil
}

func findStereotype(annotations []javaAnnotation) *javaAnnotation {
	for index := range annotations {
		if _, ok := stereotypeAnnotations[annotations[index].Name]; ok {
			return &annotations[index]
		}
	}
	return nil
}

func findInject(annotations []javaAnnotation) *javaAnnotation {
	for index := range annotations {
		if injectAnnotations[annotations[index].Name] {
			return &annotations[index]
		}
	}
	return nil
}

func findEndpoint(annotations []javaAnnotation) *javaAnnotation {
	for index := range annotations {
		if endpointAnnotations[annotations[index].Name] {
			return &annotations[index]
		}
	}
	return nil
}

// beanName è il nome del bean: quello esplicito o il nome della classe in minuscolo.
func beanName(annotation *javaAnnotation, fallback string) string {
	explicit := annotationString(annotation.Args, "value", "name")
	if explicit != "" {
		return explicit
	}
	if fallback == "" {
		return ""
	}
	return strings.ToLower(fallback[:1]) + fallback[1:]
}

// requiredOf legge `@Autowired(required=false)`; di default l'iniezione è obbligatoria.
func requiredOf(annotation *javaAnnotation) bool {
	return !strings.Contains(strings.ReplaceAll(annotation.Args, " ", ""), "required=false")
}

func qualifiersOf(annotations []javaAnnotation) []string {
	var found []string
	for _, annotation := range annotations {
		if annotation.Name == "Qualifier" {
			if value := annotationString(annotation.Args, "value", "name"); value != "" {
				found = append(found, value)
			}
		}
	}
	return found
}

func qualifierOf(annotations []javaAnnotation) string {
	found := qualifiersOf(annotations)
	if len(found) == 0 {
		return ""
	}
	return found[0]
}

// annotationString è il valore di uno dei parametri nominati di un'annotation. Per `value` accetta
// anche il valore scritto senza il nome (`@RequestMapping("/api")`), come fa Spring.
func annotationString(args string, names ...string) string {
	if strings.TrimSpace(args) == "" {
		return ""
	}
	for _, name := range names {
		match := namedArgPattern(name).FindStringSubmatch(args)
		if match == nil {
			continue
		}
		for _, group := range match[1:] {
			if group != "" {
				return strings.Trim(group, `"`)
			}
		}
	}
	for _, name := range names {
		if name == "value" {
			return annotationValue(args)
		}
	}
	return ""
}

// annotationValue è il valore scritto senza il nome del parametro (`@Service("orderService")`).
func annotationValue(args string) string {
	trimmed := strings.TrimSpace(args)
	if trimmed == "" || strings.Contains(trimmed, "=") {
		return ""
	}
	return unquote(trimmed)
}

// annotationStrings sono tutti i valori letterali di un'annotation (`@RequestMapping({"/a","/b"})`).
func annotationStrings(args string) []string {
	var values []string
	for _, match := range literalPattern.FindAllStringSubmatch(args, -1) {
		if value := unquote(match[1]); value != "" {
			values = append(values, value)
		}
	}
	return values
}

// annotationPath è il percorso di un mapping: il primo letterale che è una route, non un media type.
func annotationPath(args string) string {
	values := annotationStrings(args)
	for _, value := range values {
		if strings.HasPrefix(value, "/") {
			return value
		}
	}
	for _, value := range values {
		if !strings.Contains(value, "/") && !strings.Contains(value, "*") {
			return value
		}
	}
	return ""
}

// propertyKey estrae chiave e default da un'espressione `${chiave:default}` o da un testo che la contiene.
func propertyKey(expression string) (key, fallback string) {
	for _, match := range placeholderPattern.FindAllStringSubmatch(expression, -1) {
		inner := match[1]
		if cut := strings.Index(inner, ":"); cut >= 0 {
			return strings.TrimSpace(inner[:cut]), strings.TrimSpace(inner[cut+1:])
		}
		return strings.TrimSpace(inner), ""
	}
	return "", ""
}

// joinPath unisce il percorso della classe con quello del metodo senza doppi separatori.
func joinPath(base, path string) string {
	base = strings.TrimSuffix(base, "/")
	if !strings.HasPrefix(path, "/") && path != "" {
		path = "/" + path
	}
	if base == "" {
		return path
	}
	if path == "" {
		return base
	}
	return base + path
}

// cleanType toglie i generics dal tipo (`List<Foo>` → `List`).
func cleanType(typ string) string {
	if cut := strings.Index(typ, "<"); cut >= 0 {
		typ = typ[:cut]
	}
	return strings.TrimSpace(typ)
}

// kebabCase converte `nomeCampo` o `URLPath` in `nome-campo` / `url-path`, come fa Spring.
func kebabCase(name string) string {
	if name == "" {
		return ""
	}
	var out strings.Builder
	runes := []rune(name)
	for index, current := range runes {
		if index > 0 && isUpper(current) {
			previous := runes[index-1]
			nextIsLower := index+1 < len(runes) && isLower(runes[index+1])
			if isLower(previous) || isUpper(previous) && nextIsLower {
				out.WriteRune('-')
			}
		}
		out.WriteRune(toLower(current))
	}
	return out.String()
}

func isUpper(value rune) bool { return value >= 'A' && value <= 'Z' }
func isLower(value rune) bool { return value >= 'a' && value <= 'z' }
func toLower(value rune) rune {
	if isUpper(value) {
		return value - 'A' + 'a'
	}
	return value
}

func unquote(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && (value[0] == '"' && value[len(value)-1] == '"' || value[0] == '\'' && value[len(value)-1] == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

var literalPattern = regexp.MustCompile(`"([^"]*)"|'([^']*)'`)

var placeholderPattern = regexp.MustCompile(`\$\{([^}]*)\}`)

var namedArgsCache = map[string]*regexp.Regexp{}

func namedArgPattern(name string) *regexp.Regexp {
	if pattern, ok := namedArgsCache[name]; ok {
		return pattern
	}
	pattern := regexp.MustCompile(`(?m)\b` + name + `\s*=\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.]+))`)
	namedArgsCache[name] = pattern
	return pattern
}
