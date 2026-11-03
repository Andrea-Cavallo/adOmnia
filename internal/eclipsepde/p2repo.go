package eclipsepde

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
)

// Limits of what a p2 repository may send: Kepler's largest content.jar is 2.4 MB
// (36 MB of XML), a bundle rarely exceeds 50 MB.
const (
	maxP2MetadataBytes   = 256 << 20
	maxP2ArtifactBytes   = 512 << 20
	maxP2CompositeDepth  = 6
	p2RequestTimeout     = 5 * time.Minute
	p2NetworkCategory    = "eclipse-p2"
	p2NamespaceIU        = "org.eclipse.equinox.p2.iu"
	p2NamespaceBundle    = "osgi.bundle"
	p2NamespacePackage   = "java.package"
	p2ClassifierBundle   = "osgi.bundle"
	p2FilesUnsupportedXZ = "content.xml.xz"
)

// errP2NotFound marks a repository file that does not exist (the next variant is tried).
var errP2NotFound = errors.New("not found")

// p2Fetcher reads a repository file: over HTTP(S) through the network policy, or
// from disk for `file:` repositories.
type p2Fetcher interface {
	fetch(ctx context.Context, location string, limit int64) ([]byte, error)
	download(ctx context.Context, location string, limit int64, destination io.Writer) error
}

type p2HTTPFetcher struct{ client *http.Client }

func newP2Fetcher() p2Fetcher {
	return p2HTTPFetcher{client: netpolicy.Client(p2NetworkCategory, p2RequestTimeout)}
}

func (f p2HTTPFetcher) fetch(ctx context.Context, location string, limit int64) ([]byte, error) {
	var buffer bytes.Buffer
	if err := f.download(ctx, location, limit, &buffer); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (f p2HTTPFetcher) download(ctx context.Context, location string, limit int64, destination io.Writer) error {
	parsed, err := url.Parse(location)
	if err != nil {
		return fmt.Errorf("invalid p2 location %q: %w", location, err)
	}
	if parsed.Scheme == "file" {
		return copyLimited(parsed.Path, limit, destination)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("p2 location %q: only http, https and file repositories are supported", location)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, location, nil)
	if err != nil {
		return err
	}
	response, err := f.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return errP2NotFound
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", location, response.StatusCode)
	}
	return copyBounded(destination, response.Body, limit, location)
}

func copyLimited(file string, limit int64, destination io.Writer) error {
	source, err := os.Open(filepath.FromSlash(file))
	if errors.Is(err, os.ErrNotExist) {
		return errP2NotFound
	}
	if err != nil {
		return err
	}
	defer func() { _ = source.Close() }()
	return copyBounded(destination, source, limit, file)
}

func copyBounded(destination io.Writer, source io.Reader, limit int64, name string) error {
	written, err := io.Copy(destination, io.LimitReader(source, limit+1))
	if err != nil {
		return err
	}
	if written > limit {
		return fmt.Errorf("%s is larger than %d MB", name, limit>>20)
	}
	return nil
}

// repositoryURL normalizes a `.target` repository location: a local path becomes
// a file URL and the trailing slash is dropped, so children resolve the same way.
func repositoryURL(location string) string {
	location = strings.TrimSpace(location)
	if !strings.Contains(location, "://") && !strings.HasPrefix(location, "file:") {
		if abs, err := filepath.Abs(location); err == nil {
			location = "file://" + filepath.ToSlash(abs)
		}
	}
	if strings.HasPrefix(location, "file:") && !strings.HasPrefix(location, "file://") {
		location = "file://" + strings.TrimPrefix(location, "file:")
	}
	return strings.TrimRight(location, "/")
}

// childURL resolves a composite child (relative or absolute) against its parent.
func childURL(parent, child string) string {
	if strings.Contains(child, "://") || strings.HasPrefix(child, "file:") {
		return repositoryURL(child)
	}
	base, err := url.Parse(parent + "/")
	if err != nil {
		return parent + "/" + child
	}
	reference, err := url.Parse(child)
	if err != nil {
		return parent + "/" + child
	}
	resolved := base.ResolveReference(reference)
	resolved.Path = path.Clean(resolved.Path)
	return strings.TrimRight(resolved.String(), "/")
}

// readRepositoryFile fetches `<name>.jar` (the compressed form, tried first as
// p2 does) or `<name>.xml`. errP2NotFound means neither exists.
func readRepositoryFile(ctx context.Context, fetcher p2Fetcher, repository, name string) ([]byte, error) {
	data, err := fetcher.fetch(ctx, repository+"/"+name+".jar", maxP2MetadataBytes)
	if err == nil {
		return xmlFromJar(data, name+".xml")
	}
	if !errors.Is(err, errP2NotFound) {
		return nil, err
	}
	return fetcher.fetch(ctx, repository+"/"+name+".xml", maxP2MetadataBytes)
}

func xmlFromJar(data []byte, entry string) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("%s is not a valid jar: %w", entry, err)
	}
	for _, file := range reader.File {
		if file.Name != entry {
			continue
		}
		content, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer func() { _ = content.Close() }()
		var buffer bytes.Buffer
		if err := copyBounded(&buffer, content, maxP2MetadataBytes, entry); err != nil {
			return nil, err
		}
		return buffer.Bytes(), nil
	}
	return nil, fmt.Errorf("%s not found in its jar", entry)
}

// compositeChildren reads the children of a composite repository file and its
// `p2.atomic.composite.loading` property: when true a failing child fails the
// whole repository, as in p2; otherwise the child is skipped.
func compositeChildren(data []byte) (children []string, atomic bool, err error) {
	var doc struct {
		Properties []struct {
			Name  string `xml:"name,attr"`
			Value string `xml:"value,attr"`
		} `xml:"properties>property"`
		Children []struct {
			Location string `xml:"location,attr"`
		} `xml:"children>child"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, false, fmt.Errorf("malformed composite repository: %w", err)
	}
	for _, property := range doc.Properties {
		if property.Name == "p2.atomic.composite.loading" {
			atomic = strings.EqualFold(property.Value, "true")
		}
	}
	for _, child := range doc.Children {
		if child.Location != "" {
			children = append(children, child.Location)
		}
	}
	return children, atomic, nil
}

// walkP2Repository visits a repository and, for a composite one, its children,
// calling visit with the data of each simple repository file. kind is "Content"
// (metadata) or "Artifacts". Skipped children of non-atomic composites are
// returned as problems.
func walkP2Repository(ctx context.Context, fetcher p2Fetcher, repository, kind string, visit func(repository string, data []byte) error) ([]string, error) {
	visited := map[string]bool{}
	var problems []string
	var walk func(repository string, depth int) error
	walk = func(repository string, depth int) error {
		if visited[repository] {
			return nil
		}
		visited[repository] = true
		if depth > maxP2CompositeDepth {
			return fmt.Errorf("%s: composite repositories nested too deeply", repository)
		}
		composite, err := readRepositoryFile(ctx, fetcher, repository, "composite"+kind)
		if err == nil {
			children, atomic, err := compositeChildren(composite)
			if err != nil {
				return fmt.Errorf("%s: %w", repository, err)
			}
			for _, child := range children {
				err := walk(childURL(repository, child), depth+1)
				if err == nil {
					continue
				}
				if atomic || ctx.Err() != nil {
					return err
				}
				problems = append(problems, "skipped repository: "+err.Error())
			}
			return nil
		}
		if !errors.Is(err, errP2NotFound) {
			return fmt.Errorf("%s: %w", repository, err)
		}
		simple, err := readRepositoryFile(ctx, fetcher, repository, strings.ToLower(kind))
		if errors.Is(err, errP2NotFound) {
			return missingRepositoryError(ctx, fetcher, repository, kind)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", repository, err)
		}
		return visit(repository, simple)
	}
	err := walk(repositoryURL(repository), 0)
	return problems, err
}

// missingRepositoryError tells apart "not a p2 repository" from "only the .xz
// form", which this reader does not decompress.
func missingRepositoryError(ctx context.Context, fetcher p2Fetcher, repository, kind string) error {
	if kind == "Content" {
		if _, err := fetcher.fetch(ctx, repository+"/"+p2FilesUnsupportedXZ, 1); err == nil || !errors.Is(err, errP2NotFound) {
			return fmt.Errorf("%s publishes only %s, which is not supported yet: mirror it to a folder or use a repository with content.jar", repository, p2FilesUnsupportedXZ)
		}
	}
	return fmt.Errorf("%s is not a p2 repository (no %s.jar or %s.xml)", repository, strings.ToLower(kind), strings.ToLower(kind))
}
