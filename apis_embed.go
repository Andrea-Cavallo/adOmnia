package main

import (
	"embed"
	"io/fs"
	"log"
)

// embeddedApiCollections bundles the full public-apis YAML catalog into the
// portable binary so the Install panel can browse every API offline, regardless
// of the current working directory.
//
//go:embed all:collection-yaml
var embeddedApiCollections embed.FS

// apiCollectionsFS returns a filesystem rooted at the collection-yaml directory,
// or nil if the embedded catalog could not be opened.
func apiCollectionsFS() fs.FS {
	sub, err := fs.Sub(embeddedApiCollections, "collection-yaml")
	if err != nil {
		log.Printf("[apis] failed to open embedded collection catalog: %v", err)
		return nil
	}
	return sub
}
