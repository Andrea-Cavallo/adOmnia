package declared

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// DotnetSDK is the SDK a .NET unit asks for. The dotnet muxer itself honours global.json when the
// command runs in the unit directory; adOmnia reads it to explain a missing SDK and to keep the
// per-unit version visible instead of showing a generic "dotnet is not on PATH".
type DotnetSDK struct {
	// GlobalJSON is the file that declared the version; empty when the unit uses the default SDK.
	GlobalJSON  string `json:"globalJson,omitempty"`
	Requested   string `json:"requested,omitempty"`
	RollForward string `json:"rollForward,omitempty"`
}

type globalJSON struct {
	SDK struct {
		Version     string `json:"version"`
		RollForward string `json:"rollForward"`
	} `json:"sdk"`
}

// dotnetSDK walks up from root (bounded, like MSBuild's own search) to the first global.json.
func dotnetSDK(root string) DotnetSDK {
	directory := filepath.Clean(root)
	for range 8 {
		candidate := filepath.Join(directory, "global.json")
		if data, err := os.ReadFile(candidate); err == nil { // #nosec G304 -- a bounded probe of global.json inside the project
			var document globalJSON
			if json.Unmarshal(data, &document) == nil && document.SDK.Version != "" {
				return DotnetSDK{GlobalJSON: candidate, Requested: document.SDK.Version, RollForward: document.SDK.RollForward}
			}
			return DotnetSDK{GlobalJSON: candidate}
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return DotnetSDK{}
}

// dotnetMissingMessage names the SDK the unit expects (if any) in the install hint.
func dotnetMissingMessage(action, name, root string) string {
	sdk := dotnetSDK(root)
	if sdk.Requested != "" {
		return "dotnet is not on PATH: install the .NET SDK " + sdk.Requested + " requested by " + sdk.GlobalJSON + " to " + action + " " + name + " projects"
	}
	return "dotnet is not on PATH: install the .NET SDK to " + action + " " + name + " projects"
}
