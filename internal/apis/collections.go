// apis/collections.go — Browse and install API collections from the public-apis catalog.
// Reads YAML files from a local directory and exposes them via Wails bindings.

package apis

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// ApiEntry represents a single API from a YAML collection file.
type ApiEntry struct {
	Name        string   `json:"name" yaml:"name"`
	Slug        string   `json:"slug" yaml:"slug"`
	Description string   `json:"description" yaml:"description"`
	Categories  []string `json:"categories" yaml:"categories"`
	Type        string   `json:"type" yaml:"type"`
	IsFree      bool     `json:"isFree" yaml:"is_free"`
	Source      string   `json:"source,omitempty" yaml:"source"`
	Links       []struct {
		Name string `json:"name" yaml:"name"`
		URL  string `json:"url" yaml:"url"`
	} `json:"links" yaml:"links"`
}

// ApiCategory groups API entries by category with emoji.
type ApiCategory struct {
	Name  string     `json:"name"`
	Emoji string     `json:"emoji"`
	Count int        `json:"count"`
	Apis  []ApiEntry `json:"apis"`
}

// ApiCatalog holds the full catalog with categories and emoji map.
type ApiCatalog struct {
	Categories []ApiCategory     `json:"categories"`
	EmojiMap   map[string]string `json:"emojiMap"`
	Total      int               `json:"total"`
}

// CategoryTOC is the ordered list of categories matching the README Table of Contents.
var CategoryTOC = []string{
	"Adult",
	"AI & ML",
	"Analytics",
	"Animals",
	"Art & Design",
	"Authentication & User Management",
	"Bar & QR Codes",
	"Blockchain & Cryptocurrencies",
	"Bookmarks",
	"Books",
	"Bots",
	"Business",
	"Calendar & Time",
	"Captcha",
	"Casino & Gambling",
	"Chats & Messaging",
	"Collaboration",
	"Comics & Anime",
	"Commerce",
	"Content & Dictionaries",
	"CRM",
	"Databases",
	"Development",
	"Documents & Productivity",
	"Education",
	"Email & SMS",
	"Entertainment",
	"Environment & Nature",
	"Events",
	"Files & Storage",
	"Finance & Economics",
	"Food & Drinks",
	"Forms & Surveys",
	"Fun",
	"Games",
	"Government",
	"Hardware",
	"Health",
	"Images & Photography",
	"IoT & Home Automation",
	"Jobs",
	"Maps & Geo",
	"Marketing & SEO",
	"Music & Audio",
	"News & Feeds",
	"Open Source",
	"Payments",
	"Point of Interest",
	"Post & Logistics",
	"Project Management",
	"Random",
	"Real Estate",
	"Recognition",
	"Science & Math",
	"Scrapers & Data Mining",
	"Search",
	"Security",
	"Social",
	"Space",
	"Sport & Fitness",
	"Statistics & Data",
	"Testing",
	"Text Analysis & Tools",
	"Translation",
	"Transportation",
	"Travel",
	"URLs",
	"Validation & Verification",
	"Vehicles",
	"Video & Media",
	"Virtual & Augmented Reality",
	"Visualizations",
	"Voice",
	"Weather",
	"Wiki",
	"Other",
}

// DefaultCategoryEmojis maps categories to emoji icons.
var DefaultCategoryEmojis = map[string]string{
	"Adult":                            "🍓",
	"AI & ML":                          "🤖",
	"Analytics":                        "📈",
	"Animals":                          "🐈",
	"Art & Design":                     "🎨",
	"Authentication & User Management": "👥",
	"Bar & QR Codes":                   "🏪",
	"Blockchain & Cryptocurrencies":    "📒️",
	"Bookmarks":                        "📑",
	"Books":                            "📚",
	"Bots":                             "📝",
	"Business":                         "👔",
	"Calendar & Time":                  "📅",
	"Captcha":                          "🔒",
	"Casino & Gambling":                "🎰",
	"Chats & Messaging":                "💬",
	"Collaboration":                    "👨‍👩‍👦‍👦",
	"Comics & Anime":                   "🦸",
	"Commerce":                         "💰",
	"Content & Dictionaries":           "📖",
	"CRM":                              "🤝",
	"Databases":                        "🗄️",
	"Development":                      "👨‍💻",
	"Documents & Productivity":         "📋",
	"Education":                        "🎓",
	"Email & SMS":                      "📨",
	"Entertainment":                    "🍿",
	"Environment & Nature":             "🌲",
	"Events":                           "🏟️",
	"Files & Storage":                  "💾",
	"Finance & Economics":              "🏦",
	"Food & Drinks":                    "🍹",
	"Forms & Surveys":                  "📝",
	"Fun":                              "🤪",
	"Games":                            "🎮",
	"Government":                       "🏛️",
	"Hardware":                         "⚙️",
	"Health":                           "💊",
	"Images & Photography":             "📸",
	"IoT & Home Automation":            "🏠",
	"Jobs":                             "🛠️",
	"Maps & Geo":                       "📌",
	"Marketing & SEO":                  "💰",
	"Music & Audio":                    "🎸",
	"News & Feeds":                     "📰",
	"Open Source":                      "🔓",
	"Payments":                         "💳",
	"Point of Interest":                "🍺",
	"Post & Logistics":                 "📬",
	"Project Management":               "🚧",
	"Random":                           "🎲",
	"Real Estate":                      "🏗️",
	"Recognition":                      "👁️",
	"Science & Math":                   "🔬",
	"Scrapers & Data Mining":           "🕸️",
	"Search":                           "🔎",
	"Security":                         "🛡️",
	"Social":                           "👥",
	"Space":                            "🚀",
	"Sport & Fitness":                  "⚾",
	"Statistics & Data":                "🗃️",
	"Testing":                          "🐞",
	"Text Analysis & Tools":            "📖",
	"Translation":                      "㊗️",
	"Transportation":                   "🚇",
	"Travel":                           "✈️",
	"URLs":                             "🔗",
	"Validation & Verification":        "✅",
	"Vehicles":                         "🚗",
	"Video & Media":                    "🎥",
	"Virtual & Augmented Reality":      "📱",
	"Visualizations":                   "📊",
	"Voice":                            "🎙️",
	"Weather":                          "☔",
	"Wiki":                             "📗",
	"Other":                            "✨",
}

// CollectionStore provides Wails-bound methods for browsing API collections.
type CollectionStore struct {
	CollectionsDir string
	// Embedded is the bundled YAML catalog, used when no on-disk collections
	// directory is configured or available. It lets the portable binary ship
	// the full catalog without depending on the working directory.
	Embedded fs.FS
}

var fallbackEntries = []ApiEntry{
	{
		Name:        "JSONPlaceholder Posts",
		Slug:        "jsonplaceholder-posts",
		Description: "Public REST endpoint for fast local-first request experiments with posts.",
		Categories:  []string{"Testing", "Development"},
		Type:        "rest",
		IsFree:      true,
		Links: []struct {
			Name string `json:"name" yaml:"name"`
			URL  string `json:"url" yaml:"url"`
		}{
			{Name: "API", URL: "https://jsonplaceholder.typicode.com/posts/1"},
			{Name: "Docs", URL: "https://jsonplaceholder.typicode.com/"},
		},
	},
	{
		Name:        "HTTPBin Anything",
		Slug:        "httpbin-anything",
		Description: "Echo endpoint useful for validating headers, methods, bodies, and flow variables.",
		Categories:  []string{"Testing", "Development"},
		Type:        "rest",
		IsFree:      true,
		Links: []struct {
			Name string `json:"name" yaml:"name"`
			URL  string `json:"url" yaml:"url"`
		}{
			{Name: "API", URL: "https://httpbin.org/anything"},
			{Name: "Docs", URL: "https://httpbin.org/"},
		},
	},
	{
		Name:        "REST Countries",
		Slug:        "rest-countries",
		Description: "Country metadata API for search and response-shape testing.",
		Categories:  []string{"Government", "Travel"},
		Type:        "rest",
		IsFree:      true,
		Links: []struct {
			Name string `json:"name" yaml:"name"`
			URL  string `json:"url" yaml:"url"`
		}{
			{Name: "API", URL: "https://restcountries.com/v3.1/name/italy"},
			{Name: "Docs", URL: "https://restcountries.com/"},
		},
	},
}

// NewCollectionStore creates a new CollectionStore with the given directory.
func NewCollectionStore(dir string) *CollectionStore {
	return &CollectionStore{CollectionsDir: dir}
}

// SetCollectionsDir updates the collections directory path.
func (cs *CollectionStore) SetCollectionsDir(dir string) {
	cs.CollectionsDir = dir
}

// SetEmbeddedFS sets the bundled YAML catalog filesystem.
func (cs *CollectionStore) SetEmbeddedFS(fsys fs.FS) {
	cs.Embedded = fsys
}

// GetCatalog reads all YAML files from the collection directory and returns a catalog grouped by category.
func (cs *CollectionStore) GetCatalog() (*ApiCatalog, error) {
	entries, err := cs.readAllEntries()
	if err != nil {
		return nil, fmt.Errorf("failed to read collection entries: %w", err)
	}

	return cs.buildCatalog(entries), nil
}

// GetCatalogFromPath reads YAML files from a specific directory path.
func (cs *CollectionStore) GetCatalogFromPath(dirPath string) (*ApiCatalog, error) {
	cs.CollectionsDir = dirPath
	return cs.GetCatalog()
}

// GetApiBySlug returns a single API entry by its slug.
func (cs *CollectionStore) GetApiBySlug(slug string) (*ApiEntry, error) {
	entries, err := cs.readAllEntries()
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.Slug == slug {
			return &entry, nil
		}
	}
	return nil, fmt.Errorf("api not found: %s", slug)
}

// SearchApis searches APIs by name or description.
func (cs *CollectionStore) SearchApis(query string) ([]ApiEntry, error) {
	entries, err := cs.readAllEntries()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return entries, nil
	}

	results := make([]ApiEntry, 0)
	for _, entry := range entries {
		if strings.Contains(strings.ToLower(entry.Name), q) ||
			strings.Contains(strings.ToLower(entry.Description), q) ||
			strings.Contains(strings.ToLower(entry.Slug), q) ||
			strings.Contains(strings.ToLower(entry.Source), q) ||
			containsFold(entry.Categories, q) {
			results = append(results, entry)
		}
	}

	return results, nil
}

// readAllEntries reads all YAML files from the configured collection directory,
// falling back to the embedded catalog and finally to a small built-in list.
func (cs *CollectionStore) readAllEntries() ([]ApiEntry, error) {
	// 1. Explicit on-disk directory (e.g. a user-supplied path via
	//    GetCatalogFromPath) takes precedence so custom collections still work.
	if dir := cs.resolveDiskDir(); dir != "" {
		if entries := readEntriesFromFS(os.DirFS(dir), dir); len(entries) > 0 {
			return entries, nil
		}
	}

	// 2. Bundled catalog shipped inside the binary.
	if cs.Embedded != nil {
		if entries := readEntriesFromFS(cs.Embedded, "<embedded>"); len(entries) > 0 {
			return entries, nil
		}
	}

	// 3. Minimal built-in starters so the panel is never empty.
	return fallbackEntries, nil
}

// resolveDiskDir returns the first readable on-disk collections directory, or ""
// if none is available.
func (cs *CollectionStore) resolveDiskDir() string {
	candidates := []string{
		cs.CollectionsDir,
		"collection-yaml",
		filepath.Join("apis-collection", "collection"),
		filepath.Join("assets", "apis", "collection"),
		"collection",
	}
	seen := make(map[string]bool)
	for _, dir := range candidates {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

// readEntriesFromFS reads and parses every .yaml file at the root of fsys.
func readEntriesFromFS(fsys fs.FS, label string) []ApiEntry {
	files, err := fs.ReadDir(fsys, ".")
	if err != nil {
		log.Printf("[apis] failed to read collection dir %s: %v", label, err)
		return nil
	}

	entries := make([]ApiEntry, 0, len(files))
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".yaml") {
			continue
		}
		data, err := fs.ReadFile(fsys, f.Name())
		if err != nil {
			log.Printf("[apis] failed to read %s: %v", f.Name(), err)
			continue
		}

		var entry ApiEntry
		if err := yaml.Unmarshal(data, &entry); err != nil {
			log.Printf("[apis] failed to parse %s: %v", f.Name(), err)
			continue
		}

		if entry.Name == "" || len(entry.Categories) == 0 {
			continue
		}

		entries = append(entries, entry)
	}

	return entries
}

// buildCatalog groups entries by category following the TOC order.
func (cs *CollectionStore) buildCatalog(entries []ApiEntry) *ApiCatalog {
	categoryMap := make(map[string][]ApiEntry)
	seenCategories := make(map[string]bool)

	for _, entry := range entries {
		for _, cat := range entry.Categories {
			categoryMap[cat] = append(categoryMap[cat], entry)
			seenCategories[cat] = true
		}
	}

	categories := make([]ApiCategory, 0)
	totalApis := 0

	for _, catName := range CategoryTOC {
		apis, ok := categoryMap[catName]
		if !ok {
			continue
		}
		totalApis += len(apis)

		// Sort APIs alphabetically within category
		sort.Slice(apis, func(i, j int) bool {
			return strings.ToLower(apis[i].Name) < strings.ToLower(apis[j].Name)
		})

		emoji := DefaultCategoryEmojis[catName]
		if emoji == "" {
			emoji = "📦"
		}

		categories = append(categories, ApiCategory{
			Name:  catName,
			Emoji: emoji,
			Count: len(apis),
			Apis:  apis,
		})
	}

	// Add any categories not in the TOC
	for catName, apis := range categoryMap {
		if seenCategories[catName] && !isInTOC(catName) {
			sort.Slice(apis, func(i, j int) bool {
				return strings.ToLower(apis[i].Name) < strings.ToLower(apis[j].Name)
			})
			totalApis += len(apis)
			categories = append(categories, ApiCategory{
				Name:  catName,
				Emoji: "📦",
				Count: len(apis),
				Apis:  apis,
			})
		}
	}

	// Build emoji map
	emojiMap := make(map[string]string)
	for catName := range categoryMap {
		if emoji, ok := DefaultCategoryEmojis[catName]; ok {
			emojiMap[catName] = emoji
		} else {
			emojiMap[catName] = "📦"
		}
	}

	return &ApiCatalog{
		Categories: categories,
		EmojiMap:   emojiMap,
		Total:      totalApis,
	}
}

func isInTOC(cat string) bool {
	for _, c := range CategoryTOC {
		if c == cat {
			return true
		}
	}
	return false
}

func containsFold(values []string, query string) bool {
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}
