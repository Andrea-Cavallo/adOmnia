// themes_extended.go — Extended theme features: validation, contrast checking,
// skins directory scanning, hot reload, additional built-in themes, and token documentation.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// 1. Theme Validation
// ---------------------------------------------------------------------------

// ThemeValidationResult holds the outcome of validating a theme against the schema.
type ThemeValidationResult struct {
	Valid    bool     `json:"valid"`
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

var requiredColorTokens = []string{
	"surface-0", "surface-1", "surface-2", "surface-3", "surface-4",
	"text-1", "text-2", "text-3", "text-4",
	"border-1", "border-2", "border-3",
	"accent", "accent-hover",
	"success", "warning", "error", "info",
}

var optionalColorTokens = []string{
	"accent-light", "accent-dark", "accent-glow",
	"method-get", "method-post", "method-put", "method-patch", "method-delete", "method-head",
}

// ValidateTheme checks a theme against the required schema.
// Required color tokens: surface-0..4, text-1..4, border-1..3, accent, accent-hover, success, warning, error, info.
func (tm *ThemeManager) ValidateTheme(theme Theme) ThemeValidationResult {
	result := ThemeValidationResult{
		Valid:    true,
		Errors:   make([]string, 0),
		Warnings: make([]string, 0),
	}

	// Name must not be empty
	if strings.TrimSpace(theme.Name) == "" {
		result.Errors = append(result.Errors, "theme name must not be empty")
		result.Valid = false
	}

	// Colors must not be nil
	if theme.Colors == nil {
		result.Errors = append(result.Errors, "colors map must not be nil")
		result.Valid = false
		return result
	}

	// Check required color tokens
	for _, token := range requiredColorTokens {
		if _, ok := theme.Colors[token]; !ok {
			result.Errors = append(result.Errors, fmt.Sprintf("missing required color token: %s", token))
			result.Valid = false
		}
	}

	// Check optional color tokens (warn if missing)
	for _, token := range optionalColorTokens {
		if _, ok := theme.Colors[token]; !ok {
			result.Warnings = append(result.Warnings, fmt.Sprintf("missing optional color token: %s", token))
		}
	}

	// At least one font must be defined
	if theme.Fonts.Sans == "" && theme.Fonts.Mono == "" && theme.Fonts.Serif == "" {
		result.Errors = append(result.Errors, "at least 1 font must be defined (sans, mono, or serif)")
		result.Valid = false
	}

	return result
}

// ---------------------------------------------------------------------------
// 2. WCAG Contrast Checking
// ---------------------------------------------------------------------------

// ContrastResult holds WCAG contrast evaluation for a text/background pair.
type ContrastResult struct {
	Pair      string  `json:"pair"`
	Ratio     float64 `json:"ratio"`
	AANormal  bool    `json:"aaNormal"`
	AALarge   bool    `json:"aaLarge"`
	AAANormal bool    `json:"aaaNormal"`
	Level     string  `json:"level"`
}

// contrastPairs defines the text/background combinations to check.
var contrastPairs = [][2]string{
	{"text-1", "surface-0"},
	{"text-1", "surface-1"},
	{"text-2", "surface-0"},
	{"text-2", "surface-1"},
	{"text-3", "surface-2"},
	{"accent", "surface-0"},
	{"accent", "surface-1"},
}

// CheckContrast evaluates WCAG contrast ratios for key text/background pairs.
func (tm *ThemeManager) CheckContrast(theme Theme) []ContrastResult {
	results := make([]ContrastResult, 0, len(contrastPairs))

	for _, pair := range contrastPairs {
		fgKey := pair[0]
		bgKey := pair[1]

		fgColor, fgOk := theme.Colors[fgKey]
		bgColor, bgOk := theme.Colors[bgKey]

		if !fgOk || !bgOk {
			results = append(results, ContrastResult{
				Pair:  fgKey + "/" + bgKey,
				Ratio: 0,
				Level: "Unknown",
			})
			continue
		}

		fgLum, fgErr := relativeLuminance(fgColor)
		bgLum, bgErr := relativeLuminance(bgColor)

		if fgErr != nil || bgErr != nil {
			results = append(results, ContrastResult{
				Pair:  fgKey + "/" + bgKey,
				Ratio: 0,
				Level: "Skipped (non-hex color)",
			})
			continue
		}

		ratio := contrastRatio(fgLum, bgLum)
		aaNormal := ratio >= 4.5
		aaLarge := ratio >= 3.0
		aaaNormal := ratio >= 7.0

		level := "Fail"
		if aaaNormal {
			level = "AAA"
		} else if aaNormal {
			level = "AA"
		}

		results = append(results, ContrastResult{
			Pair:      fgKey + "/" + bgKey,
			Ratio:     math.Round(ratio*100) / 100,
			AANormal:  aaNormal,
			AALarge:   aaLarge,
			AAANormal: aaaNormal,
			Level:     level,
		})
	}

	return results
}

// relativeLuminance calculates the relative luminance of a color.
// Supports #RRGGBB and #RGB hex formats. Returns an error for non-hex values.
func relativeLuminance(color string) (float64, error) {
	color = strings.TrimSpace(color)

	if !strings.HasPrefix(color, "#") {
		return 0, fmt.Errorf("non-hex color format: %s", color)
	}

	hex := color[1:]
	if len(hex) == 3 {
		hex = string(hex[0]) + string(hex[0]) + string(hex[1]) + string(hex[1]) + string(hex[2]) + string(hex[2])
	}
	if len(hex) != 6 {
		return 0, fmt.Errorf("invalid hex color length: %s", color)
	}

	r, err := strconv.ParseUint(hex[0:2], 16, 8)
	if err != nil {
		return 0, fmt.Errorf("invalid red component: %w", err)
	}
	g, err := strconv.ParseUint(hex[2:4], 16, 8)
	if err != nil {
		return 0, fmt.Errorf("invalid green component: %w", err)
	}
	b, err := strconv.ParseUint(hex[4:6], 16, 8)
	if err != nil {
		return 0, fmt.Errorf("invalid blue component: %w", err)
	}

	rLin := linearize(float64(r) / 255.0)
	gLin := linearize(float64(g) / 255.0)
	bLin := linearize(float64(b) / 255.0)

	return 0.2126*rLin + 0.7152*gLin + 0.0722*bLin, nil
}

// linearize converts an sRGB channel value to linear.
func linearize(c float64) float64 {
	if c <= 0.03928 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

// contrastRatio computes the WCAG contrast ratio between two luminances.
func contrastRatio(l1, l2 float64) float64 {
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05)
}

// ---------------------------------------------------------------------------
// 3. Skins Directory Scanner
// ---------------------------------------------------------------------------

// GetSkinsDirectory returns the skins directory path.
func (tm *ThemeManager) GetSkinsDirectory() string {
	return filepath.Join(dataDir(), "skins")
}

// ScanSkinsDirectory scans ~/.adomnia/skins/ for .json skin files and returns them.
func (tm *ThemeManager) ScanSkinsDirectory() ([]Theme, error) {
	skinsDir := tm.GetSkinsDirectory()

	if err := os.MkdirAll(skinsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create skins directory: %w", err)
	}

	entries, err := os.ReadDir(skinsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read skins directory: %w", err)
	}

	themes := make([]Theme, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}

		filePath := filepath.Join(skinsDir, entry.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			log.Printf("[themes] failed to read skin file %s: %v", entry.Name(), err)
			continue
		}

		var theme Theme
		if err := json.Unmarshal(data, &theme); err != nil {
			log.Printf("[themes] failed to parse skin file %s: %v", entry.Name(), err)
			continue
		}

		// Ensure ID matches filename (without extension)
		if theme.ID == "" {
			theme.ID = strings.TrimSuffix(entry.Name(), ".json")
		}

		themes = append(themes, theme)
	}

	log.Printf("[themes] scanned skins directory: found %d skins", len(themes))
	return themes, nil
}

// ScanProjectThemesDirectory scans bundled repository themes under data/themes.
func (tm *ThemeManager) ScanProjectThemesDirectory() ([]Theme, error) {
	dirs := projectThemeDirectories()
	seenDirs := make(map[string]bool)
	themes := make([]Theme, 0)

	for _, dir := range dirs {
		cleanDir := filepath.Clean(dir)
		if seenDirs[cleanDir] {
			continue
		}
		seenDirs[cleanDir] = true

		dirThemes, err := scanThemeDirectory(cleanDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			log.Printf("[themes] failed to scan project themes directory %s: %v", cleanDir, err)
			continue
		}
		themes = append(themes, dirThemes...)
	}

	log.Printf("[themes] scanned project theme directories: found %d themes", len(themes))
	return themes, nil
}

func projectThemeDirectories() []string {
	dirs := []string{filepath.Join("data", "themes")}

	if cwd, err := os.Getwd(); err == nil {
		dirs = append(dirs, filepath.Join(cwd, "data", "themes"))
	}

	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 4; i++ {
			dirs = append(dirs, filepath.Join(dir, "data", "themes"))
			dir = filepath.Dir(dir)
		}
	}

	return dirs
}

func scanThemeDirectory(dir string) ([]Theme, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	themes := make([]Theme, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			log.Printf("[themes] failed to read project theme file %s: %v", entry.Name(), err)
			continue
		}

		var theme Theme
		if err := json.Unmarshal(data, &theme); err != nil {
			log.Printf("[themes] failed to parse project theme file %s: %v", entry.Name(), err)
			continue
		}
		if theme.ID == "" {
			theme.ID = strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		}
		if theme.Meta == nil {
			theme.Meta = map[string]string{}
		}
		theme.Meta["source"] = "data/themes"
		themes = append(themes, theme)
	}

	return themes, nil
}

// SaveSkinToDirectory saves a theme as a JSON file in the skins directory.
func (tm *ThemeManager) SaveSkinToDirectory(theme Theme) (string, error) {
	skinsDir := tm.GetSkinsDirectory()

	if err := os.MkdirAll(skinsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create skins directory: %w", err)
	}

	if theme.ID == "" {
		theme.ID = generateThemeID()
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if theme.CreatedAt == "" {
		theme.CreatedAt = now
	}
	theme.UpdatedAt = now

	data, err := json.MarshalIndent(theme, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal theme: %w", err)
	}

	filename := theme.ID + ".json"
	filePath := filepath.Join(skinsDir, filename)

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write skin file: %w", err)
	}

	log.Printf("[themes] saved skin to directory: %s", filePath)
	return filePath, nil
}

// ImportSkinFromURL downloads a skin JSON from a URL and installs it.
func (tm *ThemeManager) ImportSkinFromURL(url string) (*Theme, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch skin from URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("skin URL returned status %d", resp.StatusCode)
	}

	// Limit to 1MB
	limitedReader := io.LimitReader(resp.Body, 1024*1024)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read skin response body: %w", err)
	}

	var theme Theme
	if err := json.Unmarshal(data, &theme); err != nil {
		return nil, fmt.Errorf("failed to parse skin JSON from URL: %w", err)
	}

	// Validate the theme
	validation := tm.ValidateTheme(theme)
	if !validation.Valid {
		return nil, fmt.Errorf("imported skin is invalid: %s", strings.Join(validation.Errors, "; "))
	}

	// Save to skins directory
	if theme.ID == "" {
		theme.ID = generateThemeID()
	}

	if _, err := tm.SaveSkinToDirectory(theme); err != nil {
		return nil, fmt.Errorf("failed to save imported skin: %w", err)
	}

	log.Printf("[themes] imported skin from URL: %s (%s)", theme.Name, url)
	return &theme, nil
}

// ---------------------------------------------------------------------------
// 4. Hot Reload Support
// ---------------------------------------------------------------------------

// skinWatcher holds the state for the directory watcher.
type skinWatcher struct {
	mu          sync.Mutex
	active      bool
	stopCh      chan struct{}
	modTimes    map[string]time.Time
	changedIDs  []string
	changedLock sync.Mutex
}

var watcher = &skinWatcher{
	modTimes: make(map[string]time.Time),
}

// StartWatching starts a polling goroutine that checks for new/modified skins every 2 seconds.
func (tm *ThemeManager) StartWatching() error {
	watcher.mu.Lock()
	defer watcher.mu.Unlock()

	if watcher.active {
		return fmt.Errorf("watcher is already active")
	}

	skinsDir := tm.GetSkinsDirectory()
	if err := os.MkdirAll(skinsDir, 0755); err != nil {
		return fmt.Errorf("failed to create skins directory: %w", err)
	}

	stopCh := make(chan struct{})
	watcher.stopCh = stopCh
	watcher.active = true
	watcher.modTimes = make(map[string]time.Time)
	watcher.changedIDs = make([]string, 0)

	// Initial scan to populate mod times
	tm.populateModTimes(skinsDir)

	go tm.watchLoop(skinsDir, stopCh)

	log.Printf("[themes] started watching skins directory: %s", skinsDir)
	return nil
}

// StopWatching stops the directory watcher.
func (tm *ThemeManager) StopWatching() error {
	watcher.mu.Lock()
	defer watcher.mu.Unlock()

	if !watcher.active {
		return nil
	}

	close(watcher.stopCh)
	watcher.stopCh = nil
	watcher.active = false

	log.Printf("[themes] stopped watching skins directory")
	return nil
}

// IsWatching returns whether the watcher is active.
func (tm *ThemeManager) IsWatching() bool {
	watcher.mu.Lock()
	defer watcher.mu.Unlock()
	return watcher.active
}

// GetChangedSkins returns skins that changed since last check (for polling from frontend).
func (tm *ThemeManager) GetChangedSkins() []string {
	watcher.changedLock.Lock()
	defer watcher.changedLock.Unlock()

	if len(watcher.changedIDs) == 0 {
		return []string{}
	}

	changed := make([]string, len(watcher.changedIDs))
	copy(changed, watcher.changedIDs)
	watcher.changedIDs = make([]string, 0)

	return changed
}

// populateModTimes reads the current mod times for all skin files.
func (tm *ThemeManager) populateModTimes(skinsDir string) {
	entries, err := os.ReadDir(skinsDir)
	if err != nil {
		log.Printf("[themes] failed to read skins directory for initial scan: %v", err)
		return
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		watcher.modTimes[entry.Name()] = info.ModTime()
	}
}

// watchLoop polls the skins directory every 2 seconds for changes.
func (tm *ThemeManager) watchLoop(skinsDir string, stopCh <-chan struct{}) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			tm.checkForChanges(skinsDir)
		}
	}
}

// checkForChanges compares current file mod times with stored ones.
func (tm *ThemeManager) checkForChanges(skinsDir string) {
	entries, err := os.ReadDir(skinsDir)
	if err != nil {
		return
	}

	currentFiles := make(map[string]bool)
	watcher.mu.Lock()
	defer watcher.mu.Unlock()

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}

		currentFiles[entry.Name()] = true

		info, err := entry.Info()
		if err != nil {
			continue
		}

		modTime := info.ModTime()
		prevModTime, exists := watcher.modTimes[entry.Name()]

		if !exists || modTime.After(prevModTime) {
			// New or modified file
			themeID := strings.TrimSuffix(entry.Name(), ".json")
			watcher.changedLock.Lock()
			watcher.changedIDs = append(watcher.changedIDs, themeID)
			watcher.changedLock.Unlock()

			watcher.modTimes[entry.Name()] = modTime

			if !exists {
				log.Printf("[themes] detected new skin: %s", themeID)
			} else {
				log.Printf("[themes] detected modified skin: %s", themeID)
			}
		}
	}

	// Check for deleted files
	for name := range watcher.modTimes {
		if !currentFiles[name] {
			themeID := strings.TrimSuffix(name, ".json")
			watcher.changedLock.Lock()
			watcher.changedIDs = append(watcher.changedIDs, themeID)
			watcher.changedLock.Unlock()

			delete(watcher.modTimes, name)
			log.Printf("[themes] detected deleted skin: %s", themeID)
		}
	}
}

// ---------------------------------------------------------------------------
// 5. Additional Built-in Skins
// ---------------------------------------------------------------------------

// GetExtendedBuiltinThemes returns additional built-in themes beyond the core set.
func (tm *ThemeManager) GetExtendedBuiltinThemes() []Theme {
	return []Theme{
		{
			ID:          "builtin-tokyo-night",
			Name:        "Tokyo Night",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Inspired by the Tokyo Night color scheme with deep blue surfaces and soft blue accent",
			Colors: map[string]string{
				"surface-0":     "#1a1b26",
				"surface-1":     "#1f2335",
				"surface-2":     "#24283b",
				"surface-3":     "#292e42",
				"surface-4":     "#2f3549",
				"text-1":        "#c0caf5",
				"text-2":        "#a9b1d6",
				"text-3":        "#787c99",
				"text-4":        "#565f89",
				"border-1":      "#2f3549",
				"border-2":      "#292e42",
				"border-3":      "#24283b",
				"accent":        "#7aa2f7",
				"accent-hover":  "#89b4fa",
				"accent-light":  "#b4c8f8",
				"accent-dark":   "#5d7fcc",
				"accent-glow":   "rgba(122, 162, 247, 0.3)",
				"success":       "#9ece6a",
				"warning":       "#e0af68",
				"error":         "#f7768e",
				"info":          "#7dcfff",
				"method-get":    "#9ece6a",
				"method-post":   "#e0af68",
				"method-put":    "#7aa2f7",
				"method-patch":  "#bb9af7",
				"method-delete": "#f7768e",
				"method-head":   "#787c99",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{},
			Meta:    map[string]string{"builtin": "true"},
		},
		{
			ID:          "builtin-catppuccin-mocha",
			Name:        "Catppuccin Mocha",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Warm dark theme inspired by Catppuccin Mocha with mauve accent",
			Colors: map[string]string{
				"surface-0":     "#1e1e2e",
				"surface-1":     "#181825",
				"surface-2":     "#313244",
				"surface-3":     "#45475a",
				"surface-4":     "#585b70",
				"text-1":        "#cdd6f4",
				"text-2":        "#bac2de",
				"text-3":        "#a6adc8",
				"text-4":        "#6c7086",
				"border-1":      "#313244",
				"border-2":      "#45475a",
				"border-3":      "#585b70",
				"accent":        "#cba6f7",
				"accent-hover":  "#d4b8fa",
				"accent-light":  "#e4d0fc",
				"accent-dark":   "#a87edb",
				"accent-glow":   "rgba(203, 166, 247, 0.3)",
				"success":       "#a6e3a1",
				"warning":       "#f9e2af",
				"error":         "#f38ba8",
				"info":          "#89dceb",
				"method-get":    "#a6e3a1",
				"method-post":   "#f9e2af",
				"method-put":    "#89b4fa",
				"method-patch":  "#cba6f7",
				"method-delete": "#f38ba8",
				"method-head":   "#6c7086",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{},
			Meta:    map[string]string{"builtin": "true"},
		},
		{
			ID:          "builtin-solarized-dark",
			Name:        "Solarized Dark",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Classic Solarized Dark with precise contrast ratios and blue accent",
			Colors: map[string]string{
				"surface-0":     "#002b36",
				"surface-1":     "#073642",
				"surface-2":     "#0a4050",
				"surface-3":     "#114f5e",
				"surface-4":     "#1a5e6d",
				"text-1":        "#fdf6e3",
				"text-2":        "#eee8d5",
				"text-3":        "#839496",
				"text-4":        "#657b83",
				"border-1":      "#073642",
				"border-2":      "#0a4050",
				"border-3":      "#114f5e",
				"accent":        "#268bd2",
				"accent-hover":  "#3a9be0",
				"accent-light":  "#6ab4e6",
				"accent-dark":   "#1a6da8",
				"accent-glow":   "rgba(38, 139, 210, 0.3)",
				"success":       "#859900",
				"warning":       "#b58900",
				"error":         "#dc322f",
				"info":          "#2aa198",
				"method-get":    "#859900",
				"method-post":   "#b58900",
				"method-put":    "#268bd2",
				"method-patch":  "#6c71c4",
				"method-delete": "#dc322f",
				"method-head":   "#657b83",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{},
			Meta:    map[string]string{"builtin": "true"},
		},
		{
			ID:          "builtin-gruvbox-dark",
			Name:        "Gruvbox Dark",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Retro groove color scheme with warm orange accent and earthy tones",
			Colors: map[string]string{
				"surface-0":     "#282828",
				"surface-1":     "#3c3836",
				"surface-2":     "#504945",
				"surface-3":     "#665c54",
				"surface-4":     "#7c6f64",
				"text-1":        "#ebdbb2",
				"text-2":        "#d5c4a1",
				"text-3":        "#bdae93",
				"text-4":        "#a89984",
				"border-1":      "#3c3836",
				"border-2":      "#504945",
				"border-3":      "#665c54",
				"accent":        "#fe8019",
				"accent-hover":  "#ff9a3c",
				"accent-light":  "#ffb566",
				"accent-dark":   "#d56b0f",
				"accent-glow":   "rgba(254, 128, 25, 0.3)",
				"success":       "#b8bb26",
				"warning":       "#fabd2f",
				"error":         "#fb4934",
				"info":          "#83a598",
				"method-get":    "#b8bb26",
				"method-post":   "#fabd2f",
				"method-put":    "#83a598",
				"method-patch":  "#d3869b",
				"method-delete": "#fb4934",
				"method-head":   "#a89984",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{},
			Meta:    map[string]string{"builtin": "true"},
		},
		{
			ID:          "builtin-legacy-enterprise",
			Name:        "Legacy Enterprise",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Deliberately plain theme for regulated and legacy enterprise environments — no radius, no shadows, monospace Courier",
			Colors: map[string]string{
				"surface-0":     "#ffffff",
				"surface-1":     "#f5f5f5",
				"surface-2":     "#eeeeee",
				"surface-3":     "#e0e0e0",
				"surface-4":     "#d0d0d0",
				"text-1":        "#000000",
				"text-2":        "#333333",
				"text-3":        "#555555",
				"text-4":        "#777777",
				"border-1":      "#cccccc",
				"border-2":      "#999999",
				"border-3":      "#666666",
				"accent":        "#0066cc",
				"accent-hover":  "#004499",
				"accent-light":  "#3399ff",
				"accent-dark":   "#003366",
				"accent-glow":   "rgba(0, 102, 204, 0.15)",
				"success":       "#008000",
				"warning":       "#cc8800",
				"error":         "#cc0000",
				"info":          "#0066cc",
				"method-get":    "#008000",
				"method-post":   "#cc8800",
				"method-put":    "#0066cc",
				"method-patch":  "#6600cc",
				"method-delete": "#cc0000",
				"method-head":   "#555555",
			},
			Fonts: ThemeFonts{
				Sans:  "'Courier New', Courier, monospace",
				Mono:  "'Courier New', Courier, monospace",
				Serif: "'Times New Roman', Times, serif",
			},
			Spacing: map[string]string{},
			Radii: map[string]string{
				"sm":   "0px",
				"md":   "0px",
				"lg":   "0px",
				"xl":   "0px",
				"full": "0px",
			},
			Shadows: map[string]string{
				"sm": "none",
				"md": "none",
				"lg": "none",
				"xl": "none",
			},
			Meta: map[string]string{"builtin": "true", "style": "enterprise"},
		},
		{
			ID:          "builtin-obsidian-neon",
			Name:        "Obsidian Neon",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Ultra-dark obsidian surfaces with electric neon-mint accent — cyberpunk developer aesthetic",
			Colors: map[string]string{
				"surface-0":     "#08080F",
				"surface-1":     "#0D0D1A",
				"surface-2":     "#121224",
				"surface-3":     "#1A1A30",
				"surface-4":     "#22223C",
				"text-1":        "#EEEEFF",
				"text-2":        "#9999CC",
				"text-3":        "#5555AA",
				"text-4":        "#333377",
				"border-1":      "#1E1E3A",
				"border-2":      "#141428",
				"border-3":      "#0D0D1E",
				"accent":        "#00FF87",
				"accent-hover":  "#33FFAA",
				"accent-light":  "#66FFBB",
				"accent-dark":   "#00CC6A",
				"accent-glow":   "rgba(0, 255, 135, 0.22)",
				"success":       "#00FF87",
				"warning":       "#FFB800",
				"error":         "#FF3366",
				"info":          "#00CCFF",
				"method-get":    "#00FF87",
				"method-post":   "#FFB800",
				"method-put":    "#00BBFF",
				"method-patch":  "#CC88FF",
				"method-delete": "#FF3366",
				"method-head":   "#5555AA",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{
				"sm":   "0 1px 2px rgba(0,255,135,0.05)",
				"md":   "0 4px 12px rgba(0,255,135,0.08)",
				"lg":   "0 10px 30px rgba(0,255,135,0.12)",
				"glow": "0 0 20px rgba(0,255,135,0.18)",
			},
			Meta: map[string]string{"builtin": "true", "style": "neon"},
		},
		{
			ID:          "builtin-carbon-coral",
			Name:        "Carbon Coral",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "GitHub-inspired deep carbon surfaces with a vibrant coral accent — clean and modern 2024 developer palette",
			Colors: map[string]string{
				"surface-0":     "#0D1117",
				"surface-1":     "#161B22",
				"surface-2":     "#1C2128",
				"surface-3":     "#22272E",
				"surface-4":     "#2D333B",
				"text-1":        "#E6EDF3",
				"text-2":        "#8D96A0",
				"text-3":        "#636E7B",
				"text-4":        "#444C56",
				"border-1":      "#30363D",
				"border-2":      "#21262D",
				"border-3":      "#161B22",
				"accent":        "#FF6B6B",
				"accent-hover":  "#FF8E8E",
				"accent-light":  "#FFAAAA",
				"accent-dark":   "#CC4444",
				"accent-glow":   "rgba(255, 107, 107, 0.2)",
				"success":       "#3FB950",
				"warning":       "#D29922",
				"error":         "#F85149",
				"info":          "#58A6FF",
				"method-get":    "#3FB950",
				"method-post":   "#D29922",
				"method-put":    "#58A6FF",
				"method-patch":  "#BC8CFF",
				"method-delete": "#F85149",
				"method-head":   "#636E7B",
			},
			Fonts: ThemeFonts{
				Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
				Mono:  "'JetBrains Mono', 'Fira Code', monospace",
				Serif: "'Georgia', serif",
			},
			Spacing: map[string]string{},
			Radii:   map[string]string{},
			Shadows: map[string]string{},
			Meta:    map[string]string{"builtin": "true", "style": "modern"},
		},
		{
			ID:          "builtin-win95",
			Name:        "Win95 Nerd",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Authentic Windows 95 aesthetic — flat gray surfaces, navy title bars, pixel-perfect square borders, Courier. For the true nerd.",
			Colors: map[string]string{
				"surface-0":     "#C0C0C0",
				"surface-1":     "#D4D0C8",
				"surface-2":     "#BDBDBD",
				"surface-3":     "#A8A8A8",
				"surface-4":     "#909090",
				"text-1":        "#000000",
				"text-2":        "#222222",
				"text-3":        "#444444",
				"text-4":        "#666666",
				"border-1":      "#808080",
				"border-2":      "#FFFFFF",
				"border-3":      "#DFDFDF",
				"accent":        "#000080",
				"accent-hover":  "#0000AA",
				"accent-light":  "#3333CC",
				"accent-dark":   "#000055",
				"accent-glow":   "rgba(0, 0, 128, 0.15)",
				"success":       "#006400",
				"warning":       "#804000",
				"error":         "#CC0000",
				"info":          "#000080",
				"method-get":    "#005A00",
				"method-post":   "#804000",
				"method-put":    "#000080",
				"method-patch":  "#6600AA",
				"method-delete": "#CC0000",
				"method-head":   "#333333",
				// JSON syntax — high-contrast black/dark on Win95 gray
				"json-key":       "#000080",
				"json-string":    "#006400",
				"json-number":    "#8B0000",
				"json-bool":      "#6600AA",
				"json-null":      "#444444",
				"json-bracket-1": "#000000",
				"json-bracket-2": "#000000",
				"json-bracket-3": "#000000",
			},
			Fonts: ThemeFonts{
				Sans:  "'MS Sans Serif', 'Arial', sans-serif",
				Mono:  "'Courier New', Courier, monospace",
				Serif: "'Times New Roman', Times, serif",
			},
			Spacing: map[string]string{},
			Radii: map[string]string{
				"sm":   "0px",
				"md":   "0px",
				"lg":   "0px",
				"xl":   "0px",
				"full": "2px",
			},
			Shadows: map[string]string{
				"sm":   "inset -1px -1px 0 #808080, inset 1px 1px 0 #FFFFFF",
				"md":   "inset -2px -2px 0 #808080, inset 2px 2px 0 #FFFFFF",
				"lg":   "inset -2px -2px 0 #808080, inset 2px 2px 0 #FFFFFF",
				"glow": "none",
			},
			Meta: map[string]string{"builtin": "true", "style": "retro-win95"},
		},
	}
}

// ---------------------------------------------------------------------------
// 6. Token Namespace Documentation
// ---------------------------------------------------------------------------

// TokenDefinition describes a single design token in the schema.
type TokenDefinition struct {
	Key         string `json:"key"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
	Category    string `json:"category"`
	Default     string `json:"default"`
}

// GetTokenNamespace returns the complete design token schema documentation.
func (tm *ThemeManager) GetTokenNamespace() map[string][]TokenDefinition {
	return map[string][]TokenDefinition{
		"color": {
			{Key: "surface-0", Description: "Primary background / deepest surface", Required: true, Category: "color", Default: "#1a1b26"},
			{Key: "surface-1", Description: "Secondary surface / panels and cards", Required: true, Category: "color", Default: "#1f2335"},
			{Key: "surface-2", Description: "Tertiary surface / elevated elements", Required: true, Category: "color", Default: "#24283b"},
			{Key: "surface-3", Description: "Quaternary surface / hover states", Required: true, Category: "color", Default: "#292e42"},
			{Key: "surface-4", Description: "Highest elevation surface / active states", Required: true, Category: "color", Default: "#2f3549"},
			{Key: "text-1", Description: "Primary text / headings and body", Required: true, Category: "color", Default: "#c0caf5"},
			{Key: "text-2", Description: "Secondary text / labels and descriptions", Required: true, Category: "color", Default: "#a9b1d6"},
			{Key: "text-3", Description: "Tertiary text / placeholders and hints", Required: true, Category: "color", Default: "#787c99"},
			{Key: "text-4", Description: "Quaternary text / disabled and muted", Required: true, Category: "color", Default: "#565f89"},
			{Key: "border-1", Description: "Primary border / dividers and separators", Required: true, Category: "color", Default: "#2f3549"},
			{Key: "border-2", Description: "Secondary border / subtle separation", Required: true, Category: "color", Default: "#292e42"},
			{Key: "border-3", Description: "Tertiary border / faintest dividers", Required: true, Category: "color", Default: "#24283b"},
			{Key: "accent", Description: "Primary accent / interactive elements", Required: true, Category: "color", Default: "#7aa2f7"},
			{Key: "accent-hover", Description: "Accent hover state / brighter variant", Required: true, Category: "color", Default: "#89b4fa"},
			{Key: "accent-light", Description: "Light accent variant / badges and chips", Required: false, Category: "color", Default: "#b4c8f8"},
			{Key: "accent-dark", Description: "Dark accent variant / pressed states", Required: false, Category: "color", Default: "#5d7fcc"},
			{Key: "accent-glow", Description: "Accent glow / box-shadow and focus rings", Required: false, Category: "color", Default: "rgba(122, 162, 247, 0.3)"},
			{Key: "success", Description: "Success status / positive actions", Required: true, Category: "color", Default: "#9ece6a"},
			{Key: "warning", Description: "Warning status / caution indicators", Required: true, Category: "color", Default: "#e0af68"},
			{Key: "error", Description: "Error status / destructive actions", Required: true, Category: "color", Default: "#f7768e"},
			{Key: "info", Description: "Info status / neutral informational", Required: true, Category: "color", Default: "#7dcfff"},
			{Key: "method-get", Description: "HTTP GET method color", Required: false, Category: "color", Default: "#9ece6a"},
			{Key: "method-post", Description: "HTTP POST method color", Required: false, Category: "color", Default: "#e0af68"},
			{Key: "method-put", Description: "HTTP PUT method color", Required: false, Category: "color", Default: "#7aa2f7"},
			{Key: "method-patch", Description: "HTTP PATCH method color", Required: false, Category: "color", Default: "#bb9af7"},
			{Key: "method-delete", Description: "HTTP DELETE method color", Required: false, Category: "color", Default: "#f7768e"},
			{Key: "method-head", Description: "HTTP HEAD method color", Required: false, Category: "color", Default: "#787c99"},
		},
		"font": {
			{Key: "sans", Description: "Sans-serif font stack for UI text", Required: false, Category: "font", Default: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"},
			{Key: "mono", Description: "Monospace font stack for code and data", Required: false, Category: "font", Default: "'JetBrains Mono', 'Fira Code', monospace"},
			{Key: "serif", Description: "Serif font stack for editorial content", Required: false, Category: "font", Default: "'Georgia', serif"},
		},
		"spacing": {
			{Key: "xs", Description: "Extra small spacing (4px)", Required: false, Category: "spacing", Default: "4px"},
			{Key: "sm", Description: "Small spacing (8px)", Required: false, Category: "spacing", Default: "8px"},
			{Key: "md", Description: "Medium spacing (12px)", Required: false, Category: "spacing", Default: "12px"},
			{Key: "lg", Description: "Large spacing (16px)", Required: false, Category: "spacing", Default: "16px"},
			{Key: "xl", Description: "Extra large spacing (24px)", Required: false, Category: "spacing", Default: "24px"},
			{Key: "2xl", Description: "Double extra large spacing (32px)", Required: false, Category: "spacing", Default: "32px"},
			{Key: "section", Description: "Section gap spacing (48px)", Required: false, Category: "spacing", Default: "48px"},
		},
		"radius": {
			{Key: "sm", Description: "Small border radius", Required: false, Category: "radius", Default: "4px"},
			{Key: "md", Description: "Medium border radius", Required: false, Category: "radius", Default: "8px"},
			{Key: "lg", Description: "Large border radius", Required: false, Category: "radius", Default: "12px"},
			{Key: "xl", Description: "Extra large border radius", Required: false, Category: "radius", Default: "16px"},
			{Key: "full", Description: "Full border radius (pill shape)", Required: false, Category: "radius", Default: "9999px"},
		},
		"shadow": {
			{Key: "sm", Description: "Small shadow for subtle depth", Required: false, Category: "shadow", Default: "0 1px 2px rgba(0,0,0,0.1)"},
			{Key: "md", Description: "Medium shadow for cards and panels", Required: false, Category: "shadow", Default: "0 4px 6px rgba(0,0,0,0.15)"},
			{Key: "lg", Description: "Large shadow for modals and dropdowns", Required: false, Category: "shadow", Default: "0 10px 15px rgba(0,0,0,0.2)"},
			{Key: "xl", Description: "Extra large shadow for floating elements", Required: false, Category: "shadow", Default: "0 20px 25px rgba(0,0,0,0.25)"},
		},
	}
}
