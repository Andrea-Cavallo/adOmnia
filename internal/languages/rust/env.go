package rust

import "regexp"

// EnvRef è una variabile d'ambiente letta da un sorgente Rust: alimenta il form di Run, che
// propone di compilarla (stesso ruolo delle `application.yml` di Spring).
type EnvRef struct {
	Name string
	Line int
}

var (
	// envCall riconosce std::env::var("X"), env::var("X"), env!("X"), option_env!("X") e
	// dotenvy::var("X"). I gruppi sono in alternativa: il primo non vuoto è il nome.
	envCall = regexp.MustCompile(`(?:(?:std::)?env::var\s*\(\s*"([^"]*)")|(?:env!\s*\(\s*"([^"]*)")|(?:option_env!\s*\(\s*"([^"]*)")|(?:dotenvy::var\s*\(\s*"([^"]*)")`)
	// clapEnv riconosce `#[arg(env = "X")]` / `#[clap(env = "X")]` / `#[command(env = "X")]`.
	clapEnv = regexp.MustCompile(`#\[(?:arg|clap|command)\([^)]*\benv\s*=\s*"([^"]*)"`)
)

// EnvVarsInFile estrae le variabili d'ambiente lette staticamente da un sorgente Rust. Tollerante:
// una riga non riconosciuta non blocca le altre.
func EnvVarsInFile(relativePath string, data []byte) []EnvRef {
	source := string(data)
	var refs []EnvRef
	seen := map[string]bool{}
	emit := func(name string, offset int) {
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		refs = append(refs, EnvRef{Name: name, Line: lineAt(source, offset)})
	}

	for _, loc := range envCall.FindAllStringSubmatchIndex(source, -1) {
		for g := 2; g+1 < len(loc); g += 2 {
			if loc[g] >= 0 {
				emit(source[loc[g]:loc[g+1]], loc[0])
				break
			}
		}
	}
	for _, loc := range clapEnv.FindAllStringSubmatchIndex(source, -1) {
		emit(source[loc[2]:loc[3]], loc[0])
	}
	return refs
}
