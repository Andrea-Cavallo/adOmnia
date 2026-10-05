// Package protodoc estrae la documentazione dei file .proto di un progetto: servizi, RPC,
// messaggi, enum e i commenti che li descrivono. Il parsing non risolve gli import, così un
// file con dipendenze mancanti viene comunque documentato.
package protodoc

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jhump/protoreflect/desc/protoparse"
	"google.golang.org/protobuf/types/descriptorpb"
)

const (
	maxProtoFiles = 500
	maxDirDepth   = 12
)

type Field struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
	Type   string `json:"type"`
	Label  string `json:"label,omitempty"`
	Doc    string `json:"doc,omitempty"`
}

type Message struct {
	Name   string  `json:"name"`
	Doc    string  `json:"doc,omitempty"`
	Line   int     `json:"line"`
	Fields []Field `json:"fields"`
}

type EnumValue struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
	Doc    string `json:"doc,omitempty"`
}

type Enum struct {
	Name   string      `json:"name"`
	Doc    string      `json:"doc,omitempty"`
	Line   int         `json:"line"`
	Values []EnumValue `json:"values"`
}

type Method struct {
	Name            string `json:"name"`
	Doc             string `json:"doc,omitempty"`
	Line            int    `json:"line"`
	Input           string `json:"input"`
	Output          string `json:"output"`
	ClientStreaming bool   `json:"clientStreaming,omitempty"`
	ServerStreaming bool   `json:"serverStreaming,omitempty"`
}

type Service struct {
	Name    string   `json:"name"`
	Doc     string   `json:"doc,omitempty"`
	Line    int      `json:"line"`
	Methods []Method `json:"methods"`
}

// File è la documentazione di un file .proto (Error se non è stato possibile leggerlo).
type File struct {
	Path     string    `json:"path"`
	Package  string    `json:"package,omitempty"`
	Syntax   string    `json:"syntax,omitempty"`
	Doc      string    `json:"doc,omitempty"`
	Services []Service `json:"services"`
	Messages []Message `json:"messages"`
	Enums    []Enum    `json:"enums"`
	Error    string    `json:"error,omitempty"`
}

// Collect documenta ogni .proto sotto root; i percorsi restituiti sono relativi a root.
func Collect(root string) []File {
	var names []string
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || len(names) >= maxProtoFiles {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			name := entry.Name()
			if path != root && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || strings.Count(rel, "/") >= maxDirDepth) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".proto") {
			names = append(names, rel)
		}
		return nil
	})
	sort.Strings(names)
	files := make([]File, 0, len(names))
	for _, name := range names {
		files = append(files, parse(root, name))
	}
	return files
}

func parse(root, name string) File {
	parser := protoparse.Parser{IncludeSourceCodeInfo: true, Accessor: func(filename string) (io.ReadCloser, error) {
		// Letto tutto in memoria: il parser non chiude sempre il reader e su Windows il file resterebbe bloccato.
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(filename)))
		if err != nil {
			return nil, err
		}
		return io.NopCloser(bytes.NewReader(data)), nil
	}}
	result := File{Path: name, Services: []Service{}, Messages: []Message{}, Enums: []Enum{}}
	parsed, err := parser.ParseFilesButDoNotLink(name)
	if err != nil || len(parsed) == 0 {
		result.Error = fmt.Sprint(err)
		return result
	}
	descriptor := parsed[0]
	comments := commentIndex(descriptor.GetSourceCodeInfo())
	result.Package, result.Syntax = descriptor.GetPackage(), descriptor.GetSyntax()
	if result.Syntax == "" {
		result.Syntax = "proto2"
	}
	result.Doc = comments.doc([]int32{12}) // commento sopra `syntax`
	if packageDoc := comments.doc([]int32{2}); packageDoc != "" {
		result.Doc = packageDoc
	}
	for index, service := range descriptor.GetService() {
		path := []int32{6, int32(index)}
		item := Service{Name: service.GetName(), Doc: comments.doc(path), Line: comments.line(path), Methods: []Method{}}
		for methodIndex, method := range service.GetMethod() {
			methodPath := append(append([]int32{}, path...), 2, int32(methodIndex))
			item.Methods = append(item.Methods, Method{
				Name: method.GetName(), Doc: comments.doc(methodPath), Line: comments.line(methodPath),
				Input: strings.TrimPrefix(method.GetInputType(), "."), Output: strings.TrimPrefix(method.GetOutputType(), "."),
				ClientStreaming: method.GetClientStreaming(), ServerStreaming: method.GetServerStreaming(),
			})
		}
		result.Services = append(result.Services, item)
	}
	for index, message := range descriptor.GetMessageType() {
		collectMessage(&result, comments, message, "", []int32{4, int32(index)})
	}
	for index, enum := range descriptor.GetEnumType() {
		result.Enums = append(result.Enums, describeEnum(comments, enum, "", []int32{5, int32(index)}))
	}
	return result
}

func collectMessage(file *File, comments commentMap, message *descriptorpb.DescriptorProto, prefix string, path []int32) {
	if isMapEntry(message) {
		return
	}
	name := prefix + message.GetName()
	item := Message{Name: name, Doc: comments.doc(path), Line: comments.line(path), Fields: []Field{}}
	maps := map[string]*descriptorpb.DescriptorProto{}
	for _, nested := range message.GetNestedType() {
		if isMapEntry(nested) {
			maps[nested.GetName()] = nested
		}
	}
	for index, field := range message.GetField() {
		fieldPath := append(append([]int32{}, path...), 2, int32(index))
		item.Fields = append(item.Fields, Field{Name: field.GetName(), Number: field.GetNumber(), Type: fieldType(field, maps), Label: fieldLabel(field, maps), Doc: comments.doc(fieldPath)})
	}
	file.Messages = append(file.Messages, item)
	for index, nested := range message.GetNestedType() {
		collectMessage(file, comments, nested, name+".", append(append([]int32{}, path...), 3, int32(index)))
	}
	for index, enum := range message.GetEnumType() {
		file.Enums = append(file.Enums, describeEnum(comments, enum, name+".", append(append([]int32{}, path...), 4, int32(index))))
	}
}

// isMapEntry riconosce i tipi sintetici dei campi map<K,V>: senza linking l'opzione map_entry
// non è ancora impostata, quindi vale anche la forma (nome …Entry con i campi key=1 e value=2).
func isMapEntry(message *descriptorpb.DescriptorProto) bool {
	if message.GetOptions().GetMapEntry() {
		return true
	}
	fields := message.GetField()
	return strings.HasSuffix(message.GetName(), "Entry") && len(fields) == 2 &&
		fields[0].GetName() == "key" && fields[0].GetNumber() == 1 && fields[1].GetName() == "value" && fields[1].GetNumber() == 2
}

func describeEnum(comments commentMap, enum *descriptorpb.EnumDescriptorProto, prefix string, path []int32) Enum {
	item := Enum{Name: prefix + enum.GetName(), Doc: comments.doc(path), Line: comments.line(path), Values: []EnumValue{}}
	for index, value := range enum.GetValue() {
		item.Values = append(item.Values, EnumValue{Name: value.GetName(), Number: value.GetNumber(), Doc: comments.doc(append(append([]int32{}, path...), 2, int32(index)))})
	}
	return item
}

func mapEntry(field *descriptorpb.FieldDescriptorProto, maps map[string]*descriptorpb.DescriptorProto) *descriptorpb.DescriptorProto {
	// Senza linking il tipo (message o enum) non è risolto: basta il nome del tipo sintetico.
	if field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED || field.GetTypeName() == "" {
		return nil
	}
	name := field.GetTypeName()
	return maps[name[strings.LastIndex(name, ".")+1:]]
}

func fieldType(field *descriptorpb.FieldDescriptorProto, maps map[string]*descriptorpb.DescriptorProto) string {
	if entry := mapEntry(field, maps); entry != nil && len(entry.GetField()) == 2 {
		return fmt.Sprintf("map<%s, %s>", scalarOrName(entry.GetField()[0]), scalarOrName(entry.GetField()[1]))
	}
	return scalarOrName(field)
}

func scalarOrName(field *descriptorpb.FieldDescriptorProto) string {
	if field.GetTypeName() != "" {
		return strings.TrimPrefix(field.GetTypeName(), ".")
	}
	return strings.ToLower(strings.TrimPrefix(field.GetType().String(), "TYPE_"))
}

func fieldLabel(field *descriptorpb.FieldDescriptorProto, maps map[string]*descriptorpb.DescriptorProto) string {
	switch {
	case mapEntry(field, maps) != nil:
		return ""
	case field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED:
		return "repeated"
	case field.GetProto3Optional():
		return "optional"
	case field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REQUIRED:
		return "required"
	}
	return ""
}

type commentMap map[string]*descriptorpb.SourceCodeInfo_Location

func commentIndex(info *descriptorpb.SourceCodeInfo) commentMap {
	index := commentMap{}
	for _, location := range info.GetLocation() {
		index[pathKey(location.GetPath())] = location
	}
	return index
}

func pathKey(path []int32) string {
	return fmt.Sprint(path)
}

func (c commentMap) doc(path []int32) string {
	location := c[pathKey(path)]
	if location == nil {
		return ""
	}
	text := location.GetLeadingComments()
	if text == "" {
		text = location.GetTrailingComments()
	}
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for index := range lines {
		lines[index] = strings.TrimSpace(lines[index])
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func (c commentMap) line(path []int32) int {
	location := c[pathKey(path)]
	if location == nil || len(location.GetSpan()) == 0 {
		return 0
	}
	return int(location.GetSpan()[0]) + 1
}
