package themes

import (
	_ "embed"
	"encoding/json/v2"
)

//go:embed skins/vice-sunset.json
var viceSunsetJSON []byte

func viceSunsetTheme() Theme {
	var theme Theme
	if err := json.Unmarshal(viceSunsetJSON, &theme); err != nil {
		panic(err)
	}
	return theme
}
