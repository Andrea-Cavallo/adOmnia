package codestudio

import "testing"

func TestGraphFreshnessTracksRelevantChangesOnly(t *testing.T) {
	var fresh graphFreshness
	if fresh.isClean("s") {
		t.Fatal("un grafo mai verificato non è pulito")
	}
	fresh.markVerified("s", fresh.current("s"))
	if !fresh.isClean("s") {
		t.Fatal("dopo la verifica il grafo è pulito")
	}
	cases := []struct {
		name  string
		batch FilesChanged
		want  bool
	}{
		{"testo modificato", FilesChanged{Changes: []DiskChange{{RelativePath: "README.md", Kind: FileChanged}}}, false},
		{"sorgente modificato", FilesChanged{Changes: []DiskChange{{RelativePath: "a/main.go", Kind: FileChanged}}}, true},
		{"go.mod modificato", FilesChanged{Changes: []DiskChange{{RelativePath: "go.mod", Kind: FileChanged}}}, true},
		{"cartella eliminata", FilesChanged{Changes: []DiskChange{{RelativePath: "pkg", Kind: FileDeleted}}}, true},
		{"file creato", FilesChanged{Changes: []DiskChange{{RelativePath: "notes.txt", Kind: FileCreated}}}, true},
		{"overflow", FilesChanged{Overflow: true}, true},
	}
	for _, tc := range cases {
		if got := graphRelevant(tc.batch); got != tc.want {
			t.Errorf("%s: graphRelevant = %v, want %v", tc.name, got, tc.want)
		}
	}
	fresh.bump("s")
	if fresh.isClean("s") {
		t.Fatal("dopo una modifica rilevante va ricontrollato")
	}
	fresh.forget("s")
	if fresh.isClean("s") {
		t.Fatal("una sessione dimenticata non è pulita")
	}
}
