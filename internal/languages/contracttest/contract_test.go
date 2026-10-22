package contracttest_test

import (
	"testing"

	"adomnia/internal/ide/language"
	contracttest "adomnia/internal/languages/contracttest"
	"adomnia/internal/languages/golang"
	"adomnia/internal/languages/java"
	"adomnia/internal/languages/python"
	"adomnia/internal/languages/rust"
	"adomnia/internal/languages/web"
)

// TestLanguageAdaptersShareTheContract è la suite parametrica del contratto minimo: ogni adapter
// registrato deve passarla senza prove scritte a mano (MULTILANGUAGE-IDE 10.2). Aggiungere un
// linguaggio significa aggiungere una case qui, non una nuova suite.
func TestLanguageAdaptersShareTheContract(t *testing.T) {
	webLanguages := map[string]language.Language{}
	for _, adapter := range web.Languages() {
		webLanguages[adapter.ID()] = adapter
	}
	contracttest.Run(t, []contracttest.Case{
		{
			Name:     "go module",
			Language: golang.New(),
			Files: map[string]string{
				"go.mod":    "module example.com/app\n\ngo 1.26\n",
				"main.go":   "package main\n\nfunc main() {}\n",
				"README.md": "# app\n",
			},
			UnitRoot:        ".",
			Document:        "main.go",
			EditorLanguage:  "go",
			Detectable:      true,
			WantSuggestions: true,
		},
		{
			Name:     "node scripts",
			Language: webLanguages[web.ScriptID],
			Files: map[string]string{
				"package.json": `{"name":"web","scripts":{"dev":"vite","test":"vitest run"}}`,
				"src/main.ts":  "export const value = 1\n",
			},
			UnitRoot:        ".",
			Document:        "src/main.ts",
			EditorLanguage:  "typescript",
			Detectable:      true,
			WantSuggestions: true,
		},
		{
			Name:           "html documents",
			Language:       webLanguages[web.HTMLID],
			Document:       "index.html",
			EditorLanguage: "html",
		},
		{
			Name:           "css documents",
			Language:       webLanguages[web.CSSID],
			Document:       "styles.scss",
			EditorLanguage: "scss",
		},
		{
			Name:           "json documents",
			Language:       webLanguages[web.JSONID],
			Document:       "settings.json",
			EditorLanguage: "json",
		},
		{
			Name:     "maven project",
			Language: java.New(),
			Files: map[string]string{
				"pom.xml":                     mavenProject,
				"src/main/java/demo/App.java": "package demo;\n\npublic class App { public static void main(String[] args) {} }\n",
			},
			UnitRoot:       ".",
			Document:       "src/main/java/demo/App.java",
			EditorLanguage: "java",
			Detectable:     true,
		},
		{
			Name:     "python project",
			Language: python.New(),
			Files: map[string]string{
				"pyproject.toml": "[project]\nname = 'ml'\nrequires-python = '>=3.10'\n",
				"app.py":         "print('hi')\n",
			},
			UnitRoot:        ".",
			Document:        "app.py",
			EditorLanguage:  "python",
			Detectable:      true,
			WantSuggestions: true,
		},
		{
			Name:     "rust crate",
			Language: rust.New(),
			Files: map[string]string{
				"Cargo.toml":  "[package]\nname = 'app'\nversion = '0.1.0'\n",
				"src/main.rs": "fn main() {}\n",
			},
			UnitRoot:       ".",
			Document:       "src/main.rs",
			EditorLanguage: "rust",
			Detectable:     true,
		},
	})
}

const mavenProject = `<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>app</artifactId><version>1</version></project>`
