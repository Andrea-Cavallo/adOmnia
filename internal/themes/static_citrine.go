package themes

import (
	_ "embed"
	"encoding/json/v2"
)

//go:embed skins/static-citrine.json
var staticCitrineJSON []byte

// One JSON source is shared by the desktop catalog, browser fallback and exported skin.
func staticCitrineTheme() Theme {
	var theme Theme
	if err := json.Unmarshal(staticCitrineJSON, &theme); err != nil {
		panic(err)
	}
	return theme
}
