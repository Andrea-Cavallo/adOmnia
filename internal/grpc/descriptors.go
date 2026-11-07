package grpc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jhump/protoreflect/desc"            //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"github.com/jhump/protoreflect/desc/protoparse" //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Where the schema of a call comes from. Server reflection is the default; many production servers turn it
// off, so a call can also be described by .proto files (inline or on disk, with import paths, like grpcurl's
// -proto/-import-path) or by a compiled FileDescriptorSet (-protoset).

// Descriptor source kinds.
const (
	SourceReflection = "reflection"
	SourceProto      = "proto"
	SourceProtoset   = "protoset"
)

const (
	// maxDescriptorFileBytes bounds one .proto or protoset read from disk.
	maxDescriptorFileBytes = 16 << 20
	// maxCachedDescriptorSets bounds the parsed-schema cache: each entry is a whole linked file set.
	maxCachedDescriptorSets = 32
)

// DescriptorSource says how to describe the services of a call.
type DescriptorSource struct {
	Kind string `json:"kind,omitempty"`
	// Files are inline .proto sources by name (the name imports use); EntryFiles the ones to compile.
	Files      map[string]string `json:"files,omitempty"`
	EntryFiles []string          `json:"entry_files,omitempty"`
	// ProtoPaths are .proto files on disk; ImportPaths are where their imports are looked up.
	ProtoPaths  []string `json:"proto_paths,omitempty"`
	ImportPaths []string `json:"import_paths,omitempty"`
	// ProtosetBase64 or ProtosetPath is a compiled FileDescriptorSet.
	ProtosetBase64 string `json:"protoset_base64,omitempty"`
	ProtosetPath   string `json:"protoset_path,omitempty"`
}

// offline is true when the source describes the services without asking the server.
func (s *DescriptorSource) offline() bool {
	return s != nil && (s.Kind == SourceProto || s.Kind == SourceProtoset)
}

type descriptorCache struct {
	mu    sync.Mutex
	sets  map[string][]*desc.FileDescriptor
	order []string
}

var parsedDescriptors = &descriptorCache{sets: map[string][]*desc.FileDescriptor{}}

func (c *descriptorCache) get(key string) ([]*desc.FileDescriptor, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	files, ok := c.sets[key]
	return files, ok
}

func (c *descriptorCache) put(key string, files []*desc.FileDescriptor) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, known := c.sets[key]; !known {
		c.order = append(c.order, key)
	}
	c.sets[key] = files
	for len(c.order) > maxCachedDescriptorSets {
		delete(c.sets, c.order[0])
		c.order = c.order[1:]
	}
}

// loadDescriptorFiles parses (or takes from the cache) the files an offline source describes. The cache key
// is the content, so an edited .proto is parsed again and an unchanged one is not.
func loadDescriptorFiles(source DescriptorSource) ([]*desc.FileDescriptor, error) {
	switch source.Kind {
	case SourceProto:
		return loadProtoSources(source)
	case SourceProtoset:
		return loadProtoset(source)
	default:
		return nil, fmt.Errorf("descriptor source %q does not describe services offline", source.Kind)
	}
}

func contentKey(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part)) // hash.Hash.Write never fails
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func readDescriptorFile(path string, extensions ...string) ([]byte, error) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return nil, fmt.Errorf("%s: use an absolute path", path)
	}
	extension := strings.ToLower(filepath.Ext(clean))
	if !slices.Contains(extensions, extension) {
		return nil, fmt.Errorf("%s: expected a %s file", path, strings.Join(extensions, " or "))
	}
	info, err := os.Stat(clean)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxDescriptorFileBytes {
		return nil, fmt.Errorf("%s: not a regular file up to %d MiB", path, maxDescriptorFileBytes>>20)
	}
	return os.ReadFile(clean) // NOSONAR -- a schema file the user picked; the sidecar is loopback-only and token-protected
}

// loadProtoSources compiles inline sources, or .proto files on disk with their import paths. A file on disk is
// named relative to the first import path that contains it, as protoc does; its own folder is the fallback.
func loadProtoSources(source DescriptorSource) ([]*desc.FileDescriptor, error) {
	files := map[string]string{}
	for name, text := range source.Files {
		if name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/")); name != "" {
			files[name] = text
		}
	}
	entries := append([]string(nil), source.EntryFiles...)
	importPaths := cleanPaths(source.ImportPaths)
	for _, path := range source.ProtoPaths {
		if _, err := readDescriptorFile(path, ".proto"); err != nil {
			return nil, err
		}
		name, root := protoName(filepath.Clean(path), importPaths)
		if !slices.Contains(importPaths, root) {
			importPaths = append(importPaths, root)
		}
		entries = append(entries, name)
	}
	if len(entries) == 0 {
		for name := range files {
			entries = append(entries, name)
		}
	}
	if len(entries) == 0 {
		return nil, errors.New("no .proto file to compile")
	}
	sort.Strings(entries)
	key, err := protoSourcesKey(files, entries, importPaths)
	if err != nil {
		return nil, err
	}
	if cached, ok := parsedDescriptors.get(key); ok {
		return cached, nil
	}
	inline := protoparse.FileContentsFromMap(files)
	parser := protoparse.Parser{IncludeSourceCodeInfo: true, Accessor: func(name string) (io.ReadCloser, error) {
		if _, ok := files[name]; ok {
			return inline(name)
		}
		return openWithin(importPaths, name)
	}}
	parsed, err := parser.ParseFiles(entries...)
	if err != nil {
		return nil, fmt.Errorf("parse proto: %w", err)
	}
	parsedDescriptors.put(key, parsed)
	return parsed, nil
}

// openWithin opens an import from the first import path that has it; the name never leaves that folder.
func openWithin(importPaths []string, name string) (io.ReadCloser, error) {
	clean := filepath.FromSlash(name)
	if filepath.IsAbs(clean) || strings.HasPrefix(filepath.Clean(clean), "..") {
		return nil, fmt.Errorf("import %q leaves the import paths", name)
	}
	for _, root := range importPaths {
		file, err := os.Open(filepath.Join(root, clean)) // NOSONAR -- an import of a schema the user picked, inside an import path
		if err == nil {
			return file, nil
		}
	}
	return nil, fmt.Errorf("%s: %w", name, os.ErrNotExist)
}

// protoSourcesKey is the content of every file a compile can read: inline sources plus the .proto files under
// the import paths, by size and modification time (reading them all would cost as much as parsing).
func protoSourcesKey(files map[string]string, entries, importPaths []string) (string, error) {
	parts := append([]string{"proto"}, entries...)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		parts = append(parts, name, files[name])
	}
	for _, root := range importPaths {
		parts = append(parts, root)
		for _, entry := range entries {
			if info, err := os.Stat(filepath.Join(root, filepath.FromSlash(entry))); err == nil {
				parts = append(parts, entry, info.ModTime().String(), fmt.Sprint(info.Size()))
			}
		}
	}
	return contentKey(parts...), nil
}

// protoName is the import name of a .proto file and the import path it is relative to.
func protoName(path string, importPaths []string) (string, string) {
	for _, root := range importPaths {
		if relative, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(relative, "..") {
			return filepath.ToSlash(relative), root
		}
	}
	return filepath.Base(path), filepath.Dir(path)
}

func cleanPaths(paths []string) []string {
	cleaned := make([]string, 0, len(paths))
	for _, path := range paths {
		if path = strings.TrimSpace(path); path != "" && !slices.Contains(cleaned, filepath.Clean(path)) {
			cleaned = append(cleaned, filepath.Clean(path))
		}
	}
	return cleaned
}

func loadProtoset(source DescriptorSource) ([]*desc.FileDescriptor, error) {
	raw, err := protosetBytes(source)
	if err != nil {
		return nil, err
	}
	key := contentKey("protoset", string(raw))
	if cached, ok := parsedDescriptors.get(key); ok {
		return cached, nil
	}
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(raw, &set); err != nil {
		return nil, fmt.Errorf("parse FileDescriptorSet: %w", err)
	}
	linked, err := desc.CreateFileDescriptorsFromSet(&set)
	if err != nil {
		return nil, fmt.Errorf("link FileDescriptorSet: %w", err)
	}
	files := make([]*desc.FileDescriptor, 0, len(linked))
	for _, file := range set.GetFile() {
		if fd := linked[file.GetName()]; fd != nil {
			files = append(files, fd)
		}
	}
	parsedDescriptors.put(key, files)
	return files, nil
}

func protosetBytes(source DescriptorSource) ([]byte, error) {
	if source.ProtosetPath != "" {
		return readDescriptorFile(source.ProtosetPath, ".protoset", ".pb", ".bin", ".desc")
	}
	if source.ProtosetBase64 == "" {
		return nil, errors.New("no protoset to read")
	}
	raw, err := base64.StdEncoding.DecodeString(source.ProtosetBase64)
	if err != nil {
		return nil, fmt.Errorf("decode protoset: %w", err)
	}
	return raw, nil
}

// findService looks a fully qualified service name up in a set of files and their dependencies.
func findService(files []*desc.FileDescriptor, name string) *desc.ServiceDescriptor {
	for _, file := range files {
		if service := file.FindService(name); service != nil {
			return service
		}
	}
	for _, file := range files {
		if service := findService(file.GetDependencies(), name); service != nil {
			return service
		}
	}
	return nil
}

// findMessage looks a fully qualified message name up in a set of files and their dependencies.
func findMessage(files []*desc.FileDescriptor, name string) *desc.MessageDescriptor {
	for _, file := range files {
		if message := file.FindMessage(name); message != nil {
			return message
		}
	}
	for _, file := range files {
		if message := findMessage(file.GetDependencies(), name); message != nil {
			return message
		}
	}
	return nil
}

// resolveMethod finds the descriptor of service/method from the source, or from server reflection.
func resolveMethod(ctx context.Context, conn *grpc.ClientConn, source *DescriptorSource, service, method string) (*desc.MethodDescriptor, error) {
	var serviceDescriptor *desc.ServiceDescriptor
	if source.offline() {
		files, err := loadDescriptorFiles(*source)
		if err != nil {
			return nil, err
		}
		if serviceDescriptor = findService(files, service); serviceDescriptor == nil {
			return nil, fmt.Errorf("service %q is not in the loaded descriptors", service)
		}
	} else {
		reflection := grpcReflectionClient(ctx, conn)
		defer reflection.Reset()
		resolved, err := reflection.ResolveService(service)
		if err != nil {
			return nil, fmt.Errorf("resolve service with server reflection (load the .proto files if the server has no reflection): %w", err)
		}
		serviceDescriptor = resolved
	}
	methodDescriptor := serviceDescriptor.FindMethodByName(method)
	if methodDescriptor == nil {
		return nil, fmt.Errorf("method %q not found in service %q", method, service)
	}
	return methodDescriptor, nil
}

// describeMessage resolves a message type from the loaded descriptors or with server reflection.
func describeMessage(ctx context.Context, request grpcDescribeRequest) (*desc.MessageDescriptor, error) {
	if request.Descriptors.offline() {
		files, err := loadDescriptorFiles(*request.Descriptors)
		if err != nil {
			return nil, err
		}
		if message := findMessage(files, request.MessageType); message != nil {
			return message, nil
		}
		return nil, fmt.Errorf("message %q is not in the loaded descriptors", request.MessageType)
	}
	conn, err := connections.get(request.Target)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	reflection := grpcReflectionClient(outgoingContext(ctx, request.Metadata), conn)
	defer reflection.Reset()
	return reflection.ResolveMessage(request.MessageType)
}
