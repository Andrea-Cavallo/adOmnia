package devcontext

import (
	"encoding/json"
	"strings"
)

// resolvedBodyExample builds a JSON example for a DTO, inlining nested DTOs
// from the same project. Cycles and unknown shapes become `{}`, and collections
// stay empty arrays: the result is always valid JSON the user can edit.
func resolvedBodyExample(decl Entity, bodies map[string][]Entity, routeFile string) string {
	if fields := bodyFieldsOf(decl); len(fields) > 0 {
		return objectExample(fields, bodies, routeFile, 0, map[string]bool{decl.Attrs["name"]: true})
	}
	return decl.Attrs["example"]
}

func bodyFieldsOf(decl Entity) []bodyField {
	raw := decl.Attrs["fields"]
	if raw == "" {
		return nil
	}
	var fields []bodyField
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return nil
	}
	return fields
}

func objectExample(fields []bodyField, bodies map[string][]Entity, routeFile string, depth int, visited map[string]bool) string {
	if len(fields) == 0 {
		return "{}"
	}
	var builder strings.Builder
	builder.WriteByte('{')
	for index, field := range fields {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(quoteJSON(field.Name))
		builder.WriteByte(':')
		builder.WriteString(fieldExample(field.Type, bodies, routeFile, depth, visited))
	}
	builder.WriteByte('}')
	return builder.String()
}

func fieldExample(typ string, bodies map[string][]Entity, routeFile string, depth int, visited map[string]bool) string {
	typ = strings.TrimSpace(typ)
	typ = strings.TrimPrefix(typ, "*")
	switch {
	case strings.HasPrefix(typ, "[]"):
		return "[]"
	case strings.HasPrefix(typ, "map["):
		return "{}"
	case javaCollection(typ):
		return "[]"
	}
	if primitive := primitiveJSON(typ); primitive != "" {
		return primitive
	}
	name := typ
	if dot := strings.LastIndex(name, "."); dot >= 0 {
		name = name[dot+1:]
	}
	if depth >= 4 || visited[name] {
		return "{}"
	}
	decl, ok := pickDecl(bodies[name], routeFile)
	if !ok {
		return "{}"
	}
	visited[name] = true
	defer delete(visited, name)
	if fields := bodyFieldsOf(decl); len(fields) > 0 {
		return objectExample(fields, bodies, routeFile, depth+1, visited)
	}
	if example := decl.Attrs["example"]; example != "" {
		return example
	}
	return "{}"
}

func javaCollection(typ string) bool {
	for _, prefix := range []string{"List", "Set", "Collection", "Iterable", "ArrayList", "HashSet", "Stream"} {
		if strings.HasPrefix(typ, prefix) {
			return true
		}
	}
	return strings.HasSuffix(typ, "[]")
}

func primitiveJSON(typ string) string {
	switch typ {
	case "string", "String", "CharSequence", "char", "Character", "UUID":
		return `""`
	case "bool", "boolean", "Boolean":
		return "false"
	case "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "byte", "rune",
		"short", "long", "float", "double", "Byte", "Short", "Integer", "Long", "Float", "Double", "BigDecimal", "BigInteger", "Number":
		return "0"
	case "time.Time", "LocalDate", "LocalDateTime", "OffsetDateTime", "ZonedDateTime", "Instant", "Date":
		return `"1970-01-01T00:00:00Z"`
	case "time.Duration":
		return "0"
	case "any", "interface{}", "Object", "":
		return "null"
	}
	return ""
}

// quoteJSON is a small helper kept here so callers do not need encoding/json
// for a single string.
func quoteJSON(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}
