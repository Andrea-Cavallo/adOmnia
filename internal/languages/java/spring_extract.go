package java

import (
	"regexp"
	"slices"
	"strings"
)

// Annotation Spring e JAX-RS riconosciute: sono loro a dire "questo è un bean", "qui si inietta",
// "qui risponde". JAX-RS (`@Path`, `@GET`…) copre Quarkus e MicroProfile, che non usano Spring MVC.
var (
	stereotypeAnnotations = map[string]string{
		"Component": "component", "Service": "service", "Repository": "repository",
		"Controller": "controller", "RestController": "controller", "Configuration": "configuration",
		// MicroProfile/Quarkus: `@ApplicationScoped` e compagni dichiarano bean senza Spring.
		"ApplicationScoped": "component", "RequestScoped": "component", "SessionScoped": "component",
		"Singleton": "component", "Dependent": "component", "Named": "component",
	}
	injectAnnotations   = map[string]bool{"Autowired": true, "Inject": true, "Resource": true}
	endpointAnnotations = map[string]bool{
		"RequestMapping": true, "GetMapping": true, "PostMapping": true, "PutMapping": true,
		"DeleteMapping": true, "PatchMapping": true,
		// JAX-RS (Quarkus, MicroProfile, Jersey, RESTEasy).
		"GET": true, "POST": true, "PUT": true, "DELETE": true, "PATCH": true, "HEAD": true, "OPTIONS": true,
	}
	httpMethodOf = map[string]string{
		"GetMapping": "GET", "PostMapping": "POST", "PutMapping": "PUT",
		"DeleteMapping": "DELETE", "PatchMapping": "PATCH",
		// JAX-RS: il metodo HTTP è il nome dell'annotation stessa.
		"GET": "GET", "POST": "POST", "PUT": "PUT", "DELETE": "DELETE",
		"PATCH": "PATCH", "HEAD": "HEAD", "OPTIONS": "OPTIONS",
	}
	// isJaxRsMethod dice se l'annotation porta il metodo HTTP (JAX-RS) o il percorso (Spring).
	isJaxRsMethod = map[string]bool{
		"GET": true, "POST": true, "PUT": true, "DELETE": true, "PATCH": true, "HEAD": true, "OPTIONS": true,
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

// propertyReferencesOf sono i `@Value("${…}")` di Spring e i `@ConfigProperty` di MicroProfile,
// il modo in cui Quarkus legge la configurazione.
func propertyReferencesOf(sources []javaSource) []SpringPropertyReference {
	var references []SpringPropertyReference
	for _, source := range sources {
		for _, member := range source.Members {
			for _, annotation := range member.Annotations {
				if annotation.Name != "Value" && annotation.Name != "ConfigProperty" {
					continue
				}
				// MicroProfile: `@ConfigProperty(name = "chiave", defaultValue = "x")`.
				if annotation.Name == "ConfigProperty" {
					key := annotationString(annotation.Args, "name")
					if key == "" {
						continue
					}
					references = append(references, SpringPropertyReference{
						Expression: key, Key: key, Default: annotationString(annotation.Args, "defaultValue", "default"),
						Class: member.Class, Member: member.Name, File: source.File,
						Line: annotation.Line, StartColumn: annotation.StartColumn, EndColumn: annotation.EndColumn,
					})
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
				Class: decl.Name, Supertypes: decl.Supertypes, File: source.File, Line: decl.Line, StartColumn: decl.StartColumn, EndColumn: decl.EndColumn,
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
func injectionsOf(sources []javaSource, beans []SpringBean) []SpringInjection {
	beanClasses := map[string]bool{}
	for _, bean := range beans {
		if bean.Member == "" {
			beanClasses[bean.Type] = true
		}
	}
	var injections []SpringInjection
	for _, source := range sources {
		constructors := constructorCounts(source)
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
			case member.Kind == "constructor" && beanClasses[member.Class] && (constructors[member.Class] == 1 || annotation != nil):
				// Spring: con un solo costruttore si inietta da solo; con più costruttori vale quello con @Autowired.
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
	for _, source := range sources {
		injections = append(injections, lombokInjections(source, beanClasses)...)
	}
	return injections
}

// constructorCounts conta i costruttori espliciti di ogni classe del sorgente.
func constructorCounts(source javaSource) map[string]int {
	counts := map[string]int{}
	for _, member := range source.Members {
		if member.Kind == "constructor" {
			counts[member.Class]++
		}
	}
	return counts
}

// lombokInjections: `@RequiredArgsConstructor` inietta i campi `final` senza valore (e quelli `@NonNull`),
// `@AllArgsConstructor` tutti i campi non statici. Vale solo senza un costruttore scritto a mano.
func lombokInjections(source javaSource, beanClasses map[string]bool) []SpringInjection {
	var injections []SpringInjection
	constructors := constructorCounts(source)
	for _, decl := range source.Types {
		if !beanClasses[decl.Name] || constructors[decl.Name] > 0 {
			continue
		}
		required := findAnnotation(decl.Annotations, "RequiredArgsConstructor") != nil
		all := findAnnotation(decl.Annotations, "AllArgsConstructor") != nil
		if !required && !all {
			continue
		}
		for _, member := range source.Members {
			if member.Class != decl.Name || member.Kind != "field" || member.Static {
				continue
			}
			pending := member.Final && !member.Initialized
			nonNull := findAnnotation(member.Annotations, "NonNull") != nil && !member.Initialized
			if (!all || (member.Final && member.Initialized)) && (!required || (!pending && !nonNull)) {
				continue
			}
			injections = append(injections, SpringInjection{
				Kind: "constructor", Type: cleanType(member.Type), Name: member.Name,
				Qualifier: qualifierOf(member.Annotations), Required: true,
				Class: member.Class, File: source.File,
				Line: member.Line, StartColumn: member.StartColumn, EndColumn: member.EndColumn,
			})
		}
	}
	return injections
}

// endpointsOf sono gli endpoint HTTP: la route completa è il percorso della classe più quello del
// metodo. Copre Spring MVC (`@RequestMapping`/`@GetMapping`) e JAX-RS (`@Path`/`@GET`), il modello
// di Quarkus e MicroProfile.
func endpointsOf(sources []javaSource) []SpringEndpoint {
	var endpoints []SpringEndpoint
	for _, source := range sources {
		for _, decl := range source.Types {
			base := ""
			for _, annotation := range decl.Annotations {
				if annotation.Name == "RequestMapping" || annotation.Name == "Path" {
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
				// JAX-RS: il metodo HTTP è l'annotation stessa e il percorso sta in `@Path`.
				path := annotationPath(annotation.Args)
				if isJaxRsMethod[annotation.Name] {
					path = jaxRsPathOf(member)
				}
				// `@Produces`/`@Consumes` sono annotation a sé in JAX-RS, argomenti in Spring MVC.
				produces, consumes := annotationString(annotation.Args, "produces"), annotationString(annotation.Args, "consumes")
				if value := jaxRsMediaOf(member, "Produces"); value != "" {
					produces = value
				}
				if value := jaxRsMediaOf(member, "Consumes"); value != "" {
					consumes = value
				}
				endpoints = append(endpoints, SpringEndpoint{
					Method: method, Path: joinPath(base, path),
					Class: decl.Name, Member: member.Name, File: source.File,
					Produces: produces, Consumes: consumes,
					Line: annotation.Line, StartColumn: annotation.StartColumn, EndColumn: annotation.EndColumn,
				})
			}
		}
	}
	return endpoints
}

// jaxRsPathOf è il percorso del metodo in JAX-RS: l'annotation `@Path` sul metodo.
func jaxRsPathOf(member javaMember) string {
	for _, annotation := range member.Annotations {
		if annotation.Name == "Path" {
			return annotationPath(annotation.Args)
		}
	}
	return ""
}

// jaxRsMediaOf è il media type dichiarato da `@Produces`/`@Consumes` in JAX-RS.
func jaxRsMediaOf(member javaMember, name string) string {
	for _, annotation := range member.Annotations {
		if annotation.Name == name {
			for _, value := range annotationStrings(annotation.Args) {
				return value
			}
		}
	}
	return ""
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
	if slices.Contains(names, "value") {
		return annotationValue(args)
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
	match := placeholderPattern.FindStringSubmatch(expression)
	if match == nil {
		return "", ""
	}
	inner := match[1]
	if before, after, ok := strings.Cut(inner, ":"); ok {
		return strings.TrimSpace(before), strings.TrimSpace(after)
	}
	return strings.TrimSpace(inner), ""
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

// EndpointsInFile sono gli endpoint MVC di un solo sorgente, con il percorso relativo come File: serve a chi
// scansiona i file uno alla volta (il contesto di sviluppo) senza costruire l'intero indice Spring.
func EndpointsInFile(relativePath string, data []byte) []SpringEndpoint {
	source := parseJavaSource(data)
	source.File = relativePath
	return endpointsOf([]javaSource{source})
}
