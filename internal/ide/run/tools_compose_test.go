package run

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeComposeDownFlags(t *testing.T) {
	if got, err := NormalizeComposeArguments([]string{"down", "--remove-orphans", "--volumes"}); err != nil || len(got) != 3 {
		t.Fatalf("down flags = %v, %v", got, err)
	}
	for _, bad := range [][]string{{"down", "db"}, {"down", "--rmi=all"}, {"exec", "db"}} {
		if _, err := NormalizeComposeArguments(bad); err == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
}

func TestValidateToolPathsComposeHasNoDockerContext(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "docker-compose.yml"), []byte("services: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := NormalizeToolConfiguration(Configuration{Kind: RunKindDockerCompose, Target: "docker-compose.yml", ProgramArguments: []string{"up"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateToolPaths(root, root, config.Kind, config.Target, config.Docker); err != nil {
		t.Fatalf("saved compose configuration rejected: %v", err)
	}
}
