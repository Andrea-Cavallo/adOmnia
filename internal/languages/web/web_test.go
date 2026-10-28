package web

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func isWindows() bool { return runtime.GOOS == "windows" }

func TestRegistryRoutesFilesToTheirLanguage(t *testing.T) {
	registry := language.NewRegistry()
	for _, adapter := range Languages() {
		if err := registry.Register(adapter); err != nil {
			t.Fatal(err)
		}
	}
	cases := map[string][2]string{
		"src/App.tsx": {ScriptID, "typescriptreact"}, "main.js": {ScriptID, "javascript"}, "x.mts": {ScriptID, "typescript"},
		"index.html": {HTMLID, "html"}, "a.scss": {CSSID, "scss"}, "package.json": {JSONID, "json"}, "tsconfig.jsonc": {JSONID, "jsonc"},
	}
	for path, want := range cases {
		owner, languageID, ok := registry.ForPath(path)
		if !ok || owner.ID() != want[0] || languageID != want[1] {
			t.Errorf("%s → %v %s %v, want %v", path, owner, languageID, ok, want)
		}
	}
	if _, _, ok := registry.ForPath("main.go"); ok {
		t.Error("Go files must not be claimed by the web adapters")
	}
	if _, _, ok := registry.ForPath("view.gohtml"); ok {
		t.Error("Go templates must not be claimed by the HTML server")
	}
}

func TestInspectDetectsPackageManagerFromLockfileAndField(t *testing.T) {
	cases := []struct {
		name, lockfile, field, want, source string
	}{
		{"pnpm lock", "pnpm-lock.yaml", "", PNPM, "lockfile"},
		{"yarn lock", "yarn.lock", "", Yarn, "lockfile"},
		{"bun lock", "bun.lockb", "", Bun, "lockfile"},
		{"npm lock", "package-lock.json", "", NPM, "lockfile"},
		{"declared wins", "package-lock.json", `"packageManager": "pnpm@9.1.0",`, PNPM, "packageManager"},
		{"default", "", "", NPM, "default"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeFile(t, filepath.Join(dir, "package.json"), `{`+tc.field+`"name":"x","scripts":{"dev":"vite"}}`)
			if tc.lockfile != "" {
				writeFile(t, filepath.Join(dir, tc.lockfile), "")
			}
			info, err := Inspect(dir, dir)
			if err != nil || info.PackageManager != tc.want || info.PackageManagerSource != tc.source {
				t.Fatalf("got %+v err=%v", info, err)
			}
		})
	}
}

func TestInspectFindsMonorepoLockfileAboveTheApp(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "apps", "web")
	writeFile(t, filepath.Join(root, "pnpm-lock.yaml"), "")
	writeFile(t, filepath.Join(app, "package.json"), `{"name":"web","scripts":{"dev":"vite"},"dependencies":{"react":"18"}}`)
	info, err := Inspect(root, app)
	if err != nil {
		t.Fatal(err)
	}
	if info.PackageManager != PNPM || info.Relative != "apps/web" || info.Framework != "react" || info.Tool != ToolVite {
		t.Fatalf("got %+v", info)
	}
	if info.DependenciesInstalled {
		t.Fatal("missing node_modules must be reported")
	}
}

func TestInspectDevScriptAndTool(t *testing.T) {
	cases := []struct{ scripts, wantScript, wantTool string }{
		{`"dev":"vite","start":"node x"`, "dev", ToolVite},
		{`"start":"react-scripts start"`, "start", ToolCRA},
		{`"dev":"next dev -p 4000"`, "dev", ToolNext},
		{`"serve":"ng serve"`, "serve", ToolAngular},
		{`"build":"tsc"`, "", ToolUnknown},
	}
	for _, tc := range cases {
		dir := t.TempDir()
		writeFile(t, filepath.Join(dir, "package.json"), `{"scripts":{`+tc.scripts+`}}`)
		info, err := Inspect(dir, dir)
		if err != nil || info.DevScript != tc.wantScript || info.Tool != tc.wantTool {
			t.Errorf("%s → %+v err=%v", tc.scripts, info, err)
		}
	}
}

func TestInspectReportsBrokenManifestWithoutFailing(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "package.json"), `{"name": `)
	if _, err := Inspect(dir, dir); err == nil {
		t.Fatal("a broken package.json must be reported")
	}
}

func TestDevServerArgumentsOnlyForSimpleKnownScripts(t *testing.T) {
	vite := Info{Tool: ToolVite, DevScript: "dev", Scripts: map[string]string{"dev": "vite"}}
	if got := DevServerArguments(vite); !reflect.DeepEqual(got, []string{"--host", "127.0.0.1"}) {
		t.Fatalf("vite: %v", got)
	}
	composite := Info{Tool: ToolVite, DevScript: "dev", Scripts: map[string]string{"dev": "concurrently \"vite\" \"node api.js\""}}
	if got := DevServerArguments(composite); got != nil {
		t.Fatalf("a composite script must not receive extra flags: %v", got)
	}
	if got := DevServerArguments(Info{Tool: ToolUnknown, DevScript: "dev", Scripts: map[string]string{"dev": "node server.js"}}); got != nil {
		t.Fatalf("an unknown tool must not receive extra flags: %v", got)
	}
}

func TestRunScriptArguments(t *testing.T) {
	if got := RunScriptArguments(NPM, "dev", []string{"--host", "127.0.0.1"}); !reflect.DeepEqual(got, []string{"run", "dev", "--", "--host", "127.0.0.1"}) {
		t.Fatalf("npm: %v", got)
	}
	if got := RunScriptArguments(PNPM, "dev", []string{"--host"}); !reflect.DeepEqual(got, []string{"run", "dev", "--host"}) {
		t.Fatalf("pnpm: %v", got)
	}
	if got := RunScriptArguments(Yarn, "dev", nil); !reflect.DeepEqual(got, []string{"run", "dev"}) {
		t.Fatalf("no extra: %v", got)
	}
}

func TestDetectUnitsFindsAppsAndSkipsNodeModules(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"), `{"name":"root"}`)
	writeFile(t, filepath.Join(root, "apps", "web", "package.json"), `{"name":"web"}`)
	writeFile(t, filepath.Join(root, "node_modules", "dep", "package.json"), `{"name":"dep"}`)
	registry := language.NewRegistry()
	for _, adapter := range Languages() {
		_ = registry.Register(adapter)
	}
	units, err := registry.DetectUnits(context.Background(), root)
	if err != nil || len(units) != 2 || units[0].Name != "root" || units[1].Name != "web" || units[0].Language != ScriptID {
		t.Fatalf("units: %+v err=%v", units, err)
	}
}

func TestStaticSiteIsAUnitOnlyWithoutPackageJSON(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "index.html"), "<p>hi</p>")
	registry := language.NewRegistry()
	for _, adapter := range Languages() {
		_ = registry.Register(adapter)
	}
	units, _ := registry.DetectUnits(context.Background(), root)
	if len(units) != 1 || units[0].Language != HTMLID || units[0].Kind != UnitStatic {
		t.Fatalf("static unit: %+v", units)
	}
	writeFile(t, filepath.Join(root, "package.json"), `{}`)
	units, _ = registry.DetectUnits(context.Background(), root)
	if len(units) != 1 || units[0].Language != ScriptID {
		t.Fatalf("a package.json must win over index.html: %+v", units)
	}
}

func TestLocateServerPrefersProjectBinaries(t *testing.T) {
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	t.Cleanup(func() { lookPath = defaultLookPath })
	root := t.TempDir()
	if info := LocateServer(HTMLID, root, "", ""); info.Available || info.Error == "" {
		t.Fatalf("a missing server must explain itself: %+v", info)
	}
	name := "vscode-html-language-server"
	if isWindows() {
		name += ".cmd"
	}
	writeFile(t, filepath.Join(root, "node_modules", ".bin", name), "")
	if info := LocateServer(HTMLID, root, "", ""); !info.Available || info.Source != "project" {
		t.Fatalf("project server not found: %+v", info)
	}
	if info := LocateServer(ScriptID, root, "", ""); info.Available {
		t.Fatalf("typescript-language-server without TypeScript must not start: %+v", info)
	}
}

func TestLocateServerDistinguishesTypeScriptSevenWithoutTsserver(t *testing.T) {
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	t.Cleanup(func() { lookPath = defaultLookPath })
	root := t.TempDir()
	name := "typescript-language-server"
	if isWindows() {
		name += ".cmd"
	}
	writeFile(t, filepath.Join(root, "node_modules", ".bin", name), "")
	// TypeScript 7: il pacchetto esiste ma non porta più lib/tsserver.js.
	writeFile(t, filepath.Join(root, "node_modules", "typescript", "package.json"), `{"name":"typescript","version":"7.0.2"}`)
	info := LocateServer(ScriptID, root, "", "")
	if info.Available {
		t.Fatalf("TypeScript 7 without tsserver.js must not be usable: %+v", info)
	}
	for _, want := range []string{"7.0.2", "tsserver.js", "typescript@^6"} {
		if !strings.Contains(info.Error, want) {
			t.Errorf("the error must say %q, got %q", want, info.Error)
		}
	}

	// TypeScript 6 con tsserver.js invece risolve.
	writeFile(t, filepath.Join(root, "node_modules", "typescript", "package.json"), `{"name":"typescript","version":"6.0.3"}`)
	writeFile(t, filepath.Join(root, "node_modules", "typescript", "lib", "tsserver.js"), "")
	info = LocateServer(ScriptID, root, "", "")
	if !info.Available || info.Source != "project" {
		t.Fatalf("TypeScript 6 with tsserver.js must resolve: %+v", info)
	}
}

func TestManagedPackagesPinTypeScriptBelowSeven(t *testing.T) {
	// Il vincolo di versione è ciò che tiene lontana la 7: un "typescript" senza vincolo
	// installa la 7 e rompe rilevamento e avvio del server.
	found := false
	for _, pkg := range ManagedPackages {
		if strings.HasPrefix(pkg, "typescript@") {
			found = true
			if !strings.Contains(pkg, "^6") {
				t.Errorf("ManagedPackages must pin typescript below 7, got %q", pkg)
			}
		}
		if pkg == "typescript" {
			t.Error("ManagedPackages must never request an unpinned typescript")
		}
	}
	if !found {
		t.Error("ManagedPackages must include a pinned typescript")
	}
}

func TestJSONServerValidatesPackageJSONOffline(t *testing.T) {
	configuration, ok := serverConfiguration(JSONID).(map[string]any)
	if !ok {
		t.Fatal("json configuration missing")
	}
	if download := configuration["schemaDownload"].(map[string]any); download["enable"] != false {
		t.Fatal("schema download must stay disabled: adOmnia is local-first")
	}
	if schemas := configuration["schemas"].([]any); len(schemas) == 0 {
		t.Fatal("the bundled package.json schema is missing")
	}
}
