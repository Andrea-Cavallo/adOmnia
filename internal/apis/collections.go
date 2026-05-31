// apis/collections.go — Browse and install API collections from the public-apis catalog.
// Reads YAML files from a local directory and exposes them via Wails bindings.

package apis

import (
	"context"
	"fmt"
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
	Categories []ApiCategory       `json:"categories"`
	EmojiMap   map[string]string   `json:"emojiMap"`
	Total      int                 `json:"total"`
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
	"Adult":                           "🍓",
	"AI & ML":                         "🤖",
	"Analytics":                       "📈",
	"Animals":                         "🐈",
	"Art & Design":                    "🎨",
	"Authentication & User Management": "👥",
	"Bar & QR Codes":                  "🏪",
	"Blockchain & Cryptocurrencies":   "📒️",
	"Bookmarks":                       "📑",
	"Books":                           "📚",
	"Bots":                            "📝",
	"Business":                        "👔",
	"Calendar & Time":                 "📅",
	"Captcha":                         "🔒",
	"Casino & Gambling":               "🎰",
	"Chats & Messaging":               "💬",
	"Collaboration":                   "👨‍👩‍👦‍👦",
	"Comics & Anime":                  "🦸",
	"Commerce":                        "💰",
	"Content & Dictionaries":          "📖",
	"CRM":                             "🤝",
	"Databases":                       "🗄️",
	"Development":                     "👨‍💻",
	"Documents & Productivity":        "📋",
	"Education":                       "🎓",
	"Email & SMS":                     "📨",
	"Entertainment":                   "🍿",
	"Environment & Nature":            "🌲",
	"Events":                          "🏟️",
	"Files & Storage":                 "💾",
	"Finance & Economics":             "🏦",
	"Food & Drinks":                   "🍹",
	"Forms & Surveys":                 "📝",
	"Fun":                             "🤪",
	"Games":                           "🎮",
	"Government":                      "🏛️",
	"Hardware":                        "⚙️",
	"Health":                          "💊",
	"Images & Photography":            "📸",
	"IoT & Home Automation":           "🏠",
	"Jobs":                            "🛠️",
	"Maps & Geo":                      "📌",
	"Marketing & SEO":                 "💰",
	"Music & Audio":                   "🎸",
	"News & Feeds":                    "📰",
	"Open Source":                     "🔓",
	"Payments":                        "💳",
	"Point of Interest":               "🍺",
	"Post & Logistics":                "📬",
	"Project Management":              "🚧",
	"Random":                          "🎲",
	"Real Estate":                     "🏗️",
	"Recognition":                     "👁️",
	"Science & Math":                  "🔬",
	"Scrapers & Data Mining":          "🕸️",
	"Search":                          "🔎",
	"Security":                        "🛡️",
	"Social":                          "👥",
	"Space":                           "🚀",
	"Sport & Fitness":                 "⚾",
	"Statistics & Data":               "🗃️",
	"Testing":                         "🐞",
	"Text Analysis & Tools":           "📖",
	"Translation":                     "㊗️",
	"Transportation":                  "🚇",
	"Travel":                          "✈️",
	"URLs":                            "🔗",
	"Validation & Verification":       "✅",
	"Vehicles":                        "🚗",
	"Video & Media":                   "🎥",
	"Virtual & Augmented Reality":     "📱",
	"Visualizations":                  "📊",
	"Voice":                           "🎙️",
	"Weather":                         "☔",
	"Wiki":                            "📗",
	"Other":                           "✨",
}

// CollectionStore provides Wails-bound methods for browsing API collections.
type CollectionStore struct {
	CollectionsDir string
}

// NewCollectionStore creates a new CollectionStore with the given directory.
func NewCollectionStore(dir string) *CollectionStore {
	return &CollectionStore{CollectionsDir: dir}
}

// SetCollectionsDir updates the collections directory path.
func (cs *CollectionStore) SetCollectionsDir(dir string) {
	cs.CollectionsDir = dir
}

// GetCatalog reads all YAML files from the collection directory and returns a catalog grouped by category.
func (cs *CollectionStore) GetCatalog(ctx context.Context) (*ApiCatalog, error) {
	if cs.CollectionsDir == "" {
		cs.CollectionsDir = filepath.Join("C:", "Users", "Andrea", "Desktop", "apis-collection-main", "collection")
	}

	entries, err := cs.readAllEntries()
	if err != nil {
		return nil, fmt.Errorf("failed to read collection entries: %w", err)
	}

	return cs.buildCatalog(entries), nil
}

// GetCatalogFromPath reads YAML files from a specific directory path.
func (cs *CollectionStore) GetCatalogFromPath(ctx context.Context, dirPath string) (*ApiCatalog, error) {
	cs.CollectionsDir = dirPath
	return cs.GetCatalog(ctx)
}

// GetApiBySlug returns a single API entry by its slug.
func (cs *CollectionStore) GetApiBySlug(ctx context.Context, slug string) (*ApiEntry, error) {
	if cs.CollectionsDir == "" {
		cs.CollectionsDir = filepath.Join("C:", "Users", "Andrea", "Desktop", "apis-collection-main", "collection")
	}

	filePath := filepath.Join(cs.CollectionsDir, slug+".yaml")
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("api not found: %s", slug)
	}

	var entry ApiEntry
	if err := yaml.Unmarshal(data, &entry); err != nil {
		return nil, fmt.Errorf("failed to parse api file %s: %w", slug, err)
	}

	return &entry, nil
}

// SearchApis searches APIs by name or description.
func (cs *CollectionStore) SearchApis(ctx context.Context, query string) ([]ApiEntry, error) {
	if cs.CollectionsDir == "" {
		cs.CollectionsDir = filepath.Join("C:", "Users", "Andrea", "Desktop", "apis-collection-main", "collection")
	}

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
			strings.Contains(strings.ToLower(entry.Slug), q) {
			results = append(results, entry)
		}
	}

	return results, nil
}

// readAllEntries reads all YAML files from the collection directory.
func (cs *CollectionStore) readAllEntries() ([]ApiEntry, error) {
	entries := make([]ApiEntry, 0)

	entriesDir := cs.CollectionsDir
	if entriesDir == "" {
		entriesDir = filepath.Join("C:", "Users", "Andrea", "Desktop", "apis-collection-main", "collection")
	}

	files, err := os.ReadDir(entriesDir)
	if err != nil {
		// Try fallback paths
		fallbacks := []string{
			filepath.Join("C:", "Users", "Andrea", "Desktop", "apis-collection-main", "collection"),
			"collection",
		}
		for _, fb := range fallbacks {
			if fb == entriesDir {
				continue
			}
			files, err = os.ReadDir(fb)
			if err == nil {
				entriesDir = fb
				break
			}
		}
		if err != nil {
			return nil, fmt.Errorf("cannot read collections directory %s: %w", entriesDir, err)
		}
	}

	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".yaml") {
			continue
		}
		filePath := filepath.Join(entriesDir, f.Name())
		data, err := os.ReadFile(filePath)
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

	return entries, nil
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
