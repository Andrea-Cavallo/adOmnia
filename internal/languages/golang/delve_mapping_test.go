package golang

import "testing"

func TestRemoteDelveSourceMappingDirection(t *testing.T) {
	command, args := delveLaunchArguments("", DebugRequest{Mode: "remote", LocalSourceRoot: `C:\Users\Andrea\project`, RemoteSourceRoot: "/workspaces/project"}, "", "")
	if command != "attach" {
		t.Fatal(command)
	}
	mappings := args["substitutePath"].([]map[string]string)
	if mappings[0]["from"] != `C:\Users\Andrea\project` || mappings[0]["to"] != "/workspaces/project" {
		t.Fatal(mappings)
	}
	_, unchanged := delveLaunchArguments("", DebugRequest{Mode: "remote"}, "", "")
	if _, exists := unchanged["substitutePath"]; exists {
		t.Fatal("legacy attach changed")
	}
}
