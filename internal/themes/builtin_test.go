package themes

import (
	"strings"
	"testing"
)

// Every builtin ships to users without review, so a missing token would land
// as an unstyled panel rather than a build failure. Validate the whole set.
func TestBuiltinThemesValidate(t *testing.T) {
	tm := NewThemeManager()
	builtins := append(tm.GetBuiltinThemes(), tm.GetExtendedBuiltinThemes()...)

	if len(builtins) == 0 {
		t.Fatal("expected builtin themes, got none")
	}

	seen := make(map[string]bool, len(builtins))
	for _, theme := range builtins {
		if theme.ID == "" {
			t.Errorf("theme %q has no ID", theme.Name)
		}
		if seen[theme.ID] {
			t.Errorf("duplicate builtin theme ID: %s", theme.ID)
		}
		seen[theme.ID] = true

		if result := tm.ValidateTheme(theme); !result.Valid {
			t.Errorf("builtin theme %s is invalid: %v", theme.ID, result.Errors)
		}
	}
}

// The Sketch skin needs treatment that colour tokens cannot express. It signals
// that through meta.skin, which ThemeProvider turns into the data-skin
// attribute the stylesheet keys off. Losing this silently drops the paper,
// binding and drawn borders while the theme still looks fine in the picker.
func TestSketchThemeDeclaresItsSkin(t *testing.T) {
	tm := NewThemeManager()

	var sketch *Theme
	for _, theme := range tm.GetExtendedBuiltinThemes() {
		if theme.ID == "builtin-sketch" {
			t.Logf("found %s", theme.Name)
			sketch = &theme
			break
		}
	}
	if sketch == nil {
		t.Fatal("builtin-sketch theme is missing")
	}

	if got := sketch.Meta["skin"]; got != "sketch" {
		t.Errorf("meta.skin = %q, want %q", got, "sketch")
	}
	// Monaco lays out fixed character cells. A proportional handwriting face
	// here renders beautifully and puts the caret in the wrong place, so the
	// code font must keep a monospace fallback chain.
	if !strings.Contains(sketch.Fonts.Mono, "monospace") {
		t.Errorf("sketch mono font %q must fall back to monospace for Monaco",
			sketch.Fonts.Mono)
	}
	if sketch.Fonts.Sans == sketch.Fonts.Mono {
		t.Error("sketch sans is proportional and must not be reused as the code font")
	}
}

// JSON is rendered through CSS variables. Every skin must provide its own
// complete palette; otherwise switching from a dark theme can leave pale text
// on Sketch's light paper.
func TestSketchThemeDefinesReadableJSONTokens(t *testing.T) {
	tm := NewThemeManager()
	for _, theme := range tm.GetExtendedBuiltinThemes() {
		if theme.ID != "builtin-sketch" {
			continue
		}
		for _, token := range []string{"json-key", "json-string", "json-number", "json-bool", "json-null"} {
			if theme.Colors[token] == "" {
				t.Errorf("Sketch theme is missing %s", token)
			}
		}
		return
	}
	t.Fatal("builtin-sketch theme is missing")
}

// Paper-and-pencil palettes drift toward low contrast easily: graphite on cream
// looks right in a mockup and fails WCAG in the product.
func TestSketchThemeContrast(t *testing.T) {
	tm := NewThemeManager()
	for _, theme := range tm.GetExtendedBuiltinThemes() {
		if theme.ID != "builtin-sketch" {
			continue
		}
		for _, result := range tm.CheckContrast(theme) {
			t.Logf("%-18s %.2f  %s", result.Pair, result.Ratio, result.Level)
			if result.Ratio > 0 && !result.AANormal {
				t.Errorf("%s contrast %.2f is below WCAG AA (4.5)", result.Pair, result.Ratio)
			}
		}
	}
}
