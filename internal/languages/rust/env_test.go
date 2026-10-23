package rust

import "testing"

func TestEnvVarsFromMacros(t *testing.T) {
	got := EnvVarsInFile("src/main.rs", []byte(`let port = std::env::var("PORT").unwrap();
let host = env::var("HOST").unwrap();
let db = env!("DATABASE_URL");
let key = option_env!("API_KEY");
let other = dotenvy::var("OTHER")?;
`))
	names := map[string]bool{}
	for _, r := range got {
		names[r.Name] = true
	}
	for _, want := range []string{"PORT", "HOST", "DATABASE_URL", "API_KEY", "OTHER"} {
		if !names[want] {
			t.Fatalf("missing %q in %+v", want, got)
		}
	}
}

func TestEnvVarsFromClapAttributes(t *testing.T) {
	got := EnvVarsInFile("src/main.rs", []byte(`#[derive(Parser)]
struct Args {
    #[arg(long, env = "SERVER_PORT")]
    port: u16,
    #[command(env = "APP_ENV")]
    env: String,
}
`))
	names := map[string]bool{}
	for _, r := range got {
		names[r.Name] = true
	}
	if !names["SERVER_PORT"] || !names["APP_ENV"] {
		t.Fatalf("missing clap env vars in %+v", got)
	}
}

func TestEnvVarsAreDeduplicatedWithLine(t *testing.T) {
	got := EnvVarsInFile("src/main.rs", []byte("fn a() { let _ = env::var(\"PORT\"); }\nfn b() { let _ = env::var(\"PORT\"); }\n"))
	if len(got) != 1 || got[0].Name != "PORT" || got[0].Line != 1 {
		t.Fatalf("got = %+v", got)
	}
}

func TestNoEnvVarsWithoutCalls(t *testing.T) {
	got := EnvVarsInFile("src/main.rs", []byte("fn main() {}\n"))
	if len(got) != 0 {
		t.Fatalf("got = %+v", got)
	}
}
