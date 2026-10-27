package devcontext

import (
	"bytes"
	"regexp"
	"strconv"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
)

// clapEnvAssign è `env = "X"`/`env="X"` nell'attributo clap: il gate non deve dipendere dagli spazi.
var clapEnvAssign = regexp.MustCompile(`\benv\s*=`)

// detectRustEnv: le variabili d'ambiente lette da un sorgente Rust (std::env::var, env!, option_env!,
// dotenvy::var, clap `#[arg(env = …)]`) diventano entità envvar come quelle di Go e dotenv, così il
// form di Run propone di compilarle.
func detectRustEnv(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("env!")) && !bytes.Contains(data, []byte("env::")) &&
		!bytes.Contains(data, []byte("dotenvy")) && !bytes.Contains(data, []byte("option_env")) &&
		!clapEnvAssign.Match(data) {
		return nil
	}
	var out []Entity
	for _, ref := range rust.EnvVarsInFile(rel, data) {
		out = append(out, entity("envvar", ref.Name, ref.Name, ConfidenceInferred,
			map[string]string{"declFile": rel, "declLine": strconv.Itoa(ref.Line), "language": "rust"},
			Source{"rustenv", rel, ref.Line}))
	}
	return out
}
