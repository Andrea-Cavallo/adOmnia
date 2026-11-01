package declared

// same maps every extension to one LSP languageId.
func same(id string, extensions ...string) map[string]string {
	m := make(map[string]string, len(extensions))
	for _, extension := range extensions {
		m[extension] = id
	}
	return m
}

func one(command string, args ...string) []server { return []server{{command, args}} }

const clangdHint = "clangd comes with LLVM: `winget install LLVM.LLVM`, `brew install llvm` or `apt install clangd`"

// definitions: ids are stable (persisted in run data and used as language server keys) and must
// match frontend/src/components/ide/languages/declared/index.ts.
var definitions = []definition{
	{id: "cpp", name: "C/C++", editor: "cpp", extensions: map[string]string{
		".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp",
	}, servers: one("clangd", "--background-index", "--header-insertion=never"), hint: clangdHint, native: true},
	{id: "objective-c", name: "Objective-C", editor: "objective-c", extensions: same("objective-c", ".m"),
		servers: one("clangd", "--background-index"), hint: clangdHint, native: true},
	{id: "csharp", name: "C#", editor: "csharp", extensions: same("csharp", ".cs", ".csx"),
		servers: one("csharp-ls"), hint: "run `dotnet tool install --global csharp-ls`"},
	{id: "fsharp", name: "F#", editor: "fsharp", extensions: same("fsharp", ".fs", ".fsi", ".fsx"),
		servers: one("fsautocomplete"), hint: "run `dotnet tool install --global fsautocomplete`"},
	{id: "php", name: "PHP", editor: "php", extensions: same("php", ".php", ".phtml"),
		servers: []server{{"intelephense", []string{"--stdio"}}, {"phpactor", []string{"language-server"}}},
		hint:    "run `npm install -g intelephense`", npm: "intelephense@1.18.5"},
	{id: "ruby", name: "Ruby", editor: "ruby", extensions: same("ruby", ".rb", ".rake", ".gemspec"),
		filenames: same("ruby", "gemfile", "rakefile"),
		servers:   []server{{"ruby-lsp", nil}, {"solargraph", []string{"stdio"}}}, hint: "run `gem install ruby-lsp`"},
	{id: "lua", name: "Lua", editor: "lua", extensions: same("lua", ".lua"),
		servers: one("lua-language-server"), hint: "download LuaLS from https://luals.github.io and add its bin folder to PATH"},
	{id: "kotlin", name: "Kotlin", editor: "kotlin", extensions: same("kotlin", ".kt", ".kts"),
		servers: []server{{"kotlin-lsp", []string{"--stdio"}}, {"kotlin-language-server", nil}},
		hint:    "download kotlin-lsp from https://github.com/Kotlin/kotlin-lsp and add it to PATH"},
	{id: "swift", name: "Swift", editor: "swift", extensions: same("swift", ".swift"),
		servers: one("sourcekit-lsp"), hint: "install the Swift toolchain from https://www.swift.org: it includes sourcekit-lsp", native: true},
	{id: "dart", name: "Dart", editor: "dart", extensions: same("dart", ".dart"),
		servers: one("dart", "language-server", "--protocol=lsp"), hint: "install the Dart SDK or Flutter: the language server is part of `dart`"},
	{id: "shellscript", name: "Shell Script", editor: "shell", extensions: same("shellscript", ".sh", ".bash", ".zsh"),
		servers: one("bash-language-server", "start"), hint: "run `npm install -g bash-language-server`", npm: "bash-language-server@5.8.1"},
	{id: "scala", name: "Scala", editor: "scala", extensions: same("scala", ".scala", ".sc", ".sbt"),
		servers: one("metals"), hint: "with Coursier, run `cs install metals`"},
	{id: "elixir", name: "Elixir", editor: "elixir", extensions: same("elixir", ".ex", ".exs"),
		servers: one("elixir-ls"), hint: "unpack an ElixirLS release and expose its language server script on PATH as `elixir-ls`"},
	{id: "haskell", name: "Haskell", editor: "haskell", extensions: same("haskell", ".hs"),
		servers: one("haskell-language-server-wrapper", "--lsp"), hint: "run `ghcup install hls`"},
	{id: "zig", name: "Zig", editor: "zig", extensions: same("zig", ".zig", ".zon"),
		servers: one("zls"), hint: "download the zls build for your Zig version and add it to PATH", native: true},
	{id: "perl", name: "Perl", editor: "perl", extensions: same("perl", ".pl", ".pm"),
		servers: one("perlnavigator", "--stdio"), hint: "run `npm install -g perlnavigator-server`", npm: "perlnavigator-server@0.8.20"},
	{id: "r", name: "R", editor: "r", extensions: same("r", ".r"),
		servers: one("R", "--no-echo", "-e", "languageserver::run()"), hint: "in an R console run `install.packages(\"languageserver\")`"},
	{id: "julia", name: "Julia", editor: "julia", extensions: same("julia", ".jl"),
		servers: one("julia", "--startup-file=no", "--history-file=no", "--quiet", "-e", "using LanguageServer; runserver()"),
		hint:    "in the Julia REPL press `]` and run `add LanguageServer`"},
	{id: "clojure", name: "Clojure", editor: "clojure", extensions: same("clojure", ".clj", ".cljs", ".cljc", ".edn"),
		servers: one("clojure-lsp"), hint: "download clojure-lsp from https://clojure-lsp.io and add it to PATH"},
	// XML matters for the enterprise side (WSDL, XSD, SOAP envelopes, Maven POMs).
	{id: "xml", name: "XML", editor: "xml", extensions: same("xml", ".xml", ".xsd", ".wsdl", ".xsl", ".xslt", ".pom"),
		servers: one("lemminx"), hint: "download the LemMinX binary for your OS and add it to PATH as `lemminx`"},
	{id: "dockerfile", name: "Dockerfile", editor: "dockerfile", extensions: same("dockerfile", ".dockerfile"),
		filenames: same("dockerfile", "dockerfile", "containerfile"),
		servers:   one("docker-langserver", "--stdio"), hint: "run `npm install -g dockerfile-language-server-nodejs`", npm: "dockerfile-language-server-nodejs@0.15.0"},
	{id: "terraform", name: "Terraform", editor: "hcl", extensions: map[string]string{".tf": "terraform", ".tfvars": "terraform-vars"},
		servers: one("terraform-ls", "serve"), hint: "download terraform-ls from HashiCorp and add it to PATH"},
	{id: "graphql", name: "GraphQL", editor: "graphql", extensions: same("graphql", ".graphql", ".graphqls", ".gql"),
		servers: one("graphql-lsp", "server", "-m", "stream"), hint: "run `npm install -g graphql-language-service-cli`", npm: "graphql-language-service-cli@3.5.0"},
}
