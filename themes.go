// themes.go — Theme/skin system for adOmnia.
// Themes are JSON objects that define CSS custom properties.
// Users can create, import, export, and switch themes.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	bolt "go.etcd.io/bbolt"
)

// Theme represents a complete visual theme with CSS custom property overrides.
type Theme struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Author      string            `json:"author"`
	Version     string            `json:"version"`
	Description string            `json:"description"`
	Colors      map[string]string `json:"colors"`
	Fonts       ThemeFonts        `json:"fonts"`
	Spacing     map[string]string `json:"spacing"`
	Radii       map[string]string `json:"radii"`
	Shadows     map[string]string `json:"shadows"`
	Meta        map[string]string `json:"meta"`
	CreatedAt   string            `json:"createdAt"`
	UpdatedAt   string            `json:"updatedAt"`
}

// ThemeFonts holds font family definitions for a theme.
type ThemeFonts struct {
	Sans  string `json:"sans"`
	Mono  string `json:"mono"`
	Serif string `json:"serif"`
}

// ThemeManager provides Wails-bound methods for theme management.
type ThemeManager struct{}

// NewThemeManager creates a new ThemeManager instance.
func NewThemeManager() *ThemeManager {
	return &ThemeManager{}
}

func generateThemeID() string {
	return fmt.Sprintf("theme-%d", time.Now().UnixNano())
}

// GetThemes returns all user-installed themes from the bbolt "themes" bucket.
func (tm *ThemeManager) GetThemes() ([]Theme, error) {
	themes := make([]Theme, 0)

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("themes"))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var t Theme
			if err := json.Unmarshal(v, &t); err != nil {
				log.Printf("[themes] failed to unmarshal theme %s: %v", string(k), err)
				continue
			}
			themes = append(themes, t)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list themes: %w", err)
	}

	return themes, nil
}

// GetTheme retrieves a single theme by ID from the store.
func (tm *ThemeManager) GetTheme(id string) (*Theme, error) {
	var theme Theme

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("themes"))
		if b == nil {
			return fmt.Errorf("themes bucket not found")
		}
		v := b.Get([]byte(id))
		if v == nil {
			return fmt.Errorf("theme not found: %s", id)
		}
		return json.Unmarshal(v, &theme)
	})
	if err != nil {
		return nil, err
	}

	return &theme, nil
}

// SaveTheme upserts a theme into the store. Generates an ID if empty.
func (tm *ThemeManager) SaveTheme(theme Theme) error {
	now := time.Now().UTC().Format(time.RFC3339)

	if theme.ID == "" {
		theme.ID = generateThemeID()
		theme.CreatedAt = now
	}
	theme.UpdatedAt = now

	data, err := json.Marshal(theme)
	if err != nil {
		return fmt.Errorf("failed to marshal theme: %w", err)
	}

	err = storeDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte("themes"))
		if err != nil {
			return err
		}
		return b.Put([]byte(theme.ID), data)
	})
	if err != nil {
		return fmt.Errorf("failed to save theme: %w", err)
	}

	log.Printf("[themes] saved theme: %s (%s)", theme.Name, theme.ID)
	return nil
}

// DeleteTheme removes a theme from the store by ID.
func (tm *ThemeManager) DeleteTheme(id string) error {
	err := storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("themes"))
		if b == nil {
			return nil
		}
		return b.Delete([]byte(id))
	})
	if err != nil {
		return fmt.Errorf("failed to delete theme: %w", err)
	}

	log.Printf("[themes] deleted theme: %s", id)
	return nil
}

// ExportTheme returns the JSON string representation of a theme.
func (tm *ThemeManager) ExportTheme(id string) (string, error) {
	theme, err := tm.GetTheme(id)
	if err != nil {
		return "", err
	}

	data, err := json.MarshalIndent(theme, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to export theme: %w", err)
	}

	return string(data), nil
}

// ImportTheme parses a JSON string and saves the theme to the store.
func (tm *ThemeManager) ImportTheme(jsonStr string) (*Theme, error) {
	var theme Theme
	if err := json.Unmarshal([]byte(jsonStr), &theme); err != nil {
		return nil, fmt.Errorf("failed to parse theme JSON: %w", err)
	}

	// Assign a new ID to avoid collisions
	theme.ID = generateThemeID()
	theme.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	theme.UpdatedAt = theme.CreatedAt

	if err := tm.SaveTheme(theme); err != nil {
		return nil, err
	}

	log.Printf("[themes] imported theme: %s (%s)", theme.Name, theme.ID)
	return &theme, nil
}

// ImportThemeFile reads a theme JSON file from disk and imports it.
func (tm *ThemeManager) ImportThemeFile(filePath string) (*Theme, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read theme file: %w", err)
	}

	return tm.ImportTheme(string(data))
}

// GetActiveThemeID returns the currently active theme ID from settings.
func (tm *ThemeManager) GetActiveThemeID() (string, error) {
	var activeID string

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("settings"))
		if b == nil {
			return nil
		}
		v := b.Get([]byte("activeTheme"))
		if v != nil {
			activeID = string(v)
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to get active theme: %w", err)
	}

	return activeID, nil
}

// SetActiveThemeID saves the active theme ID to the settings bucket.
func (tm *ThemeManager) SetActiveThemeID(id string) error {
	err := storeDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte("settings"))
		if err != nil {
			return err
		}
		return b.Put([]byte("activeTheme"), []byte(id))
	})
	if err != nil {
		return fmt.Errorf("failed to set active theme: %w", err)
	}

	log.Printf("[themes] active theme set to: %s", id)
	return nil
}

// GetBuiltinThemes returns hardcoded built-in themes (not stored in DB).
func (tm *ThemeManager) GetBuiltinThemes() []Theme {
	return []Theme{
		{
			ID:          "builtin-dark",
			Name:        "adOmnia Dark",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Default dark theme with cyan accent and deep surfaces",
			Colors: map[string]string{
				"surface-0":    "oklch(12% 0.01 250)",
				"surface-1":    "oklch(15% 0.01 250)",
				"surface-2":    "oklch(18% 0.01 250)",
				"surface-3":    "oklch(22% 0.01 250)",
				"text-1":       "oklch(95% 0 0)",
				"text-2":       "oklch(80% 0 0)",
				"text-3":       "oklch(65% 0 0)",
				"text-4":       "oklch(55% 0 0)",
				"accent":       "oklch(75% 0.15 195)",
				"accent-hover": "oklch(80% 0.17 195)",
				"border-1":     "oklch(28% 0.01 250)",
				"border-2":     "oklch(22% 0.01 250)",
				"success":      "oklch(72% 0.18 155)",
				"warning":      "oklch(78% 0.16 80)",
				"error":        "oklch(65% 0.2 25)",
				"info":         "oklch(72% 0.14 230)",
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
			ID:          "builtin-light",
			Name:        "adOmnia Light",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Clean light theme with blue accent and bright surfaces",
			Colors: map[string]string{
				"surface-0":    "oklch(98% 0.005 250)",
				"surface-1":    "oklch(96% 0.005 250)",
				"surface-2":    "oklch(93% 0.005 250)",
				"surface-3":    "oklch(90% 0.005 250)",
				"text-1":       "oklch(12% 0 0)",
				"text-2":       "oklch(25% 0 0)",
				"text-3":       "oklch(40% 0 0)",
				"text-4":       "oklch(55% 0 0)",
				"accent":       "oklch(55% 0.2 250)",
				"accent-hover": "oklch(50% 0.22 250)",
				"border-1":     "oklch(85% 0.005 250)",
				"border-2":     "oklch(90% 0.005 250)",
				"success":      "oklch(55% 0.18 155)",
				"warning":      "oklch(65% 0.16 80)",
				"error":        "oklch(55% 0.22 25)",
				"info":         "oklch(55% 0.16 230)",
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
			ID:          "builtin-midnight",
			Name:        "Midnight",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Pure black surfaces with vibrant purple accent",
			Colors: map[string]string{
				"surface-0":    "oklch(5% 0.01 290)",
				"surface-1":    "oklch(8% 0.01 290)",
				"surface-2":    "oklch(12% 0.01 290)",
				"surface-3":    "oklch(16% 0.01 290)",
				"text-1":       "oklch(95% 0.01 290)",
				"text-2":       "oklch(80% 0.01 290)",
				"text-3":       "oklch(65% 0.01 290)",
				"text-4":       "oklch(50% 0.01 290)",
				"accent":       "oklch(68% 0.22 295)",
				"accent-hover": "oklch(73% 0.24 295)",
				"border-1":     "oklch(20% 0.02 290)",
				"border-2":     "oklch(15% 0.02 290)",
				"success":      "oklch(72% 0.18 155)",
				"warning":      "oklch(78% 0.16 80)",
				"error":        "oklch(65% 0.2 25)",
				"info":         "oklch(68% 0.15 270)",
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
			ID:          "builtin-forest",
			Name:        "Forest",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Deep green tones with emerald accent inspired by nature",
			Colors: map[string]string{
				"surface-0":    "oklch(10% 0.02 155)",
				"surface-1":    "oklch(13% 0.02 155)",
				"surface-2":    "oklch(16% 0.02 155)",
				"surface-3":    "oklch(20% 0.02 155)",
				"text-1":       "oklch(93% 0.02 155)",
				"text-2":       "oklch(78% 0.02 155)",
				"text-3":       "oklch(62% 0.02 155)",
				"text-4":       "oklch(50% 0.02 155)",
				"accent":       "oklch(70% 0.18 160)",
				"accent-hover": "oklch(75% 0.2 160)",
				"border-1":     "oklch(25% 0.03 155)",
				"border-2":     "oklch(20% 0.03 155)",
				"success":      "oklch(75% 0.2 145)",
				"warning":      "oklch(78% 0.16 80)",
				"error":        "oklch(65% 0.2 25)",
				"info":         "oklch(68% 0.14 200)",
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
			ID:          "builtin-sunset",
			Name:        "Sunset",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Warm dark tones with orange and amber accents",
			Colors: map[string]string{
				"surface-0":    "oklch(11% 0.015 50)",
				"surface-1":    "oklch(14% 0.015 50)",
				"surface-2":    "oklch(17% 0.015 50)",
				"surface-3":    "oklch(21% 0.015 50)",
				"text-1":       "oklch(94% 0.02 60)",
				"text-2":       "oklch(80% 0.02 60)",
				"text-3":       "oklch(64% 0.02 60)",
				"text-4":       "oklch(52% 0.02 60)",
				"accent":       "oklch(75% 0.17 55)",
				"accent-hover": "oklch(80% 0.19 55)",
				"border-1":     "oklch(26% 0.02 50)",
				"border-2":     "oklch(20% 0.02 50)",
				"success":      "oklch(72% 0.18 155)",
				"warning":      "oklch(80% 0.18 70)",
				"error":        "oklch(65% 0.22 20)",
				"info":         "oklch(68% 0.14 230)",
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
			ID:          "builtin-nord",
			Name:        "Nord",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Description: "Inspired by the Nord color palette with arctic blues",
			Colors: map[string]string{
				"surface-0":    "oklch(22% 0.02 240)",
				"surface-1":    "oklch(25% 0.02 240)",
				"surface-2":    "oklch(29% 0.02 240)",
				"surface-3":    "oklch(33% 0.02 240)",
				"text-1":       "oklch(93% 0.01 225)",
				"text-2":       "oklch(80% 0.01 225)",
				"text-3":       "oklch(65% 0.01 225)",
				"text-4":       "oklch(55% 0.01 225)",
				"accent":       "oklch(72% 0.12 215)",
				"accent-hover": "oklch(77% 0.14 215)",
				"border-1":     "oklch(35% 0.02 240)",
				"border-2":     "oklch(30% 0.02 240)",
				"success":      "oklch(72% 0.14 155)",
				"warning":      "oklch(78% 0.14 80)",
				"error":        "oklch(65% 0.18 15)",
				"info":         "oklch(70% 0.12 240)",
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
	}
}
