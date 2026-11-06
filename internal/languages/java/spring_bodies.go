package java

import (
	"strconv"
	"strings"
)

// SpringBody is a DTO declaration with a JSON example generated from its
// fields. The Developer Context uses it to prefill a request body.
type SpringBody struct {
	Name     string            `json:"name"`
	FullName string            `json:"fullName"`
	Example  string            `json:"example"`
	Fields   []SpringBodyField `json:"fields,omitempty"`
	File     string            `json:"file"`
	Line     int               `json:"line"`
}

// SpringBodyField is one DTO property, kept so nested types can be resolved
// across files when the request body is generated.
type SpringBodyField struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// BodyDeclsInFile returns the class/record shapes declared by one Java source.
// It reads fields and record components; nested DTOs stay `{}` on purpose, so a
// generated body is always valid JSON the developer can edit.
func BodyDeclsInFile(relativePath string, data []byte) []SpringBody {
	source := parseJavaSource(data)
	source.File = relativePath
	var out []SpringBody
	for _, decl := range source.Types {
		if decl.Kind == "enum" || decl.Kind == "interface" {
			continue
		}
		fields := javaBodyFields(source, decl)
		example := javaBodyExample(fields)
		if example == "" {
			continue
		}
		out = append(out, SpringBody{Name: decl.Short, FullName: decl.Name, Example: example, Fields: fields, File: relativePath, Line: decl.Line})
	}
	return out
}

func javaBodyFields(source javaSource, decl javaTypeDecl) []SpringBodyField {
	var fields []SpringBodyField
	seen := map[string]bool{}
	for _, component := range decl.Components {
		name := component.Name
		if name == "" {
			continue
		}
		fields = append(fields, SpringBodyField{Name: name, Type: cleanType(component.Type)})
		seen[name] = true
	}
	for _, member := range source.Members {
		if member.Class != decl.Name || member.Kind != "field" || member.Static {
			continue
		}
		if hasAnnotation(member.Annotations, "JsonIgnore") {
			continue
		}
		name := jsonPropertyName(member.Annotations, member.Name)
		if name == "" || seen[name] {
			continue
		}
		fields = append(fields, SpringBodyField{Name: name, Type: cleanType(member.Type)})
		seen[name] = true
	}
	return fields
}

func hasAnnotation(annotations []javaAnnotation, name string) bool {
	for _, annotation := range annotations {
		if annotation.Name == name {
			return true
		}
	}
	return false
}

func jsonPropertyName(annotations []javaAnnotation, fallback string) string {
	for _, annotation := range annotations {
		if annotation.Name == "JsonProperty" {
			if value := annotationString(annotation.Args, "value", "name"); value != "" {
				return value
			}
		}
	}
	return fallback
}

func javaBodyExample(fields []SpringBodyField) string {
	if len(fields) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteByte('{')
	for index, field := range fields {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.Quote(field.Name))
		builder.WriteByte(':')
		builder.WriteString(javaZeroJSON(field.Type))
	}
	builder.WriteByte('}')
	return builder.String()
}

// javaZeroJSON maps common Java types to a valid JSON placeholder.
func javaZeroJSON(typ string) string {
	typ = strings.TrimSpace(typ)
	switch typ {
	case "String", "CharSequence", "char", "Character", "UUID":
		return `""`
	case "boolean", "Boolean":
		return "false"
	case "byte", "short", "int", "long", "float", "double", "Byte", "Short", "Integer", "Long", "Float", "Double", "BigDecimal", "BigInteger", "Number":
		return "0"
	case "LocalDate", "LocalDateTime", "OffsetDateTime", "ZonedDateTime", "Instant", "Date":
		return `"1970-01-01T00:00:00Z"`
	}
	if strings.HasPrefix(typ, "List") || strings.HasPrefix(typ, "Set") || strings.HasPrefix(typ, "Collection") || strings.HasPrefix(typ, "Iterable") || strings.HasPrefix(typ, "ArrayList") || strings.HasPrefix(typ, "HashSet") || strings.HasSuffix(typ, "[]") {
		return "[]"
	}
	if strings.HasPrefix(typ, "Map") || strings.HasPrefix(typ, "HashMap") {
		return "{}"
	}
	if typ == "Object" || typ == "any" || typ == "" {
		return "null"
	}
	return "{}"
}
