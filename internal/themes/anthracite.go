package themes

// anthraciteTheme is the graphite look of the reference IDE screenshot. Its
// colors were measured on that image: the editor is the darkest surface and the
// panels get lighter around it. Keep frontend/src/lib/anthracitePalette.ts aligned.
func anthraciteTheme() Theme {
	return Theme{
		ID:          "builtin-anthracite",
		Name:        "adOmnia Anthracite",
		Author:      "adOmnia",
		Version:     "1.0.0",
		Description: "Graphite surfaces with vivid syntax colors",
		Colors: map[string]string{
			"on-accent":      "#1C202A",
			"surface-0":      "#1C202A",
			"surface-1":      "#2B2F38",
			"surface-2":      "#30343C",
			"surface-3":      "#3B3F4A",
			"surface-4":      "#454951",
			"text-1":         "#F4F4F4",
			"text-2":         "#C5C8CD",
			"text-3":         "#A4A8B0",
			"text-4":         "#9B9FA6",
			"accent":         "#E6E8EC",
			"accent-hover":   "#FFFFFF",
			"accent-light":   "#FFFFFF",
			"accent-dark":    "#C5C8CD",
			"accent-glow":    "rgba(255, 255, 255, 0.14)",
			"border-1":       "#30343D",
			"border-2":       "#3E424C",
			"border-3":       "#52565F",
			"success":        "#1BD480",
			"warning":        "#F8C709",
			"error":          "#F0707A",
			"info":           "#14B6EC",
			"json-key":       "#2FEFF3",
			"json-string":    "#BCEC80",
			"json-number":    "#F8D28F",
			"json-bool":      "#CDABF0",
			"json-null":      "#F48FB5",
			"json-bracket-1": "#FFE60A",
			"json-bracket-2": "#E65C8E",
			"json-bracket-3": "#5FDCF8",
		},
		Fonts: ThemeFonts{
			Sans:  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
			Mono:  "'JetBrains Mono', 'Fira Code', monospace",
			Serif: "'Georgia', serif",
		},
		Spacing: map[string]string{},
		Radii:   map[string]string{},
		Shadows: map[string]string{},
		Meta:    map[string]string{"builtin": "true", "mode": "dark"},
	}
}
