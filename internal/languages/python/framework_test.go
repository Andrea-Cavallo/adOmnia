package python

import (
	"encoding/json"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
)

// TestFrameworkServerUsesGuidedFields: host, porta e reload sono opzioni validate, non argomenti
// liberi; il comando li traduce nell'ordine del framework (PY-7.2).
func TestFrameworkServerUsesGuidedFields(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	for _, test := range []struct {
		name    string
		options Options
		want    string
	}{
		{
			name:    "uvicorn with reload",
			options: Options{Interpreter: interpreter, Module: "uvicorn", App: "app.main:app", Host: "0.0.0.0", Port: 9000, Reload: true},
			want:    "-u -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload",
		},
		{
			name:    "flask defaults",
			options: Options{Interpreter: interpreter, Module: "flask", App: "app:create_app"},
			want:    "-u -m flask --app app:create_app run",
		},
		{
			name:    "plain module stays python -m",
			options: Options{Interpreter: interpreter, Module: "package.main"},
			want:    "-u -m package.main",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, _ := json.Marshal(test.options)
			spec, err := New().CommandSpec(run.Request{Root: root, WorkingDirectory: root, Kind: "module", LanguageOptions: data})
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(spec.Arguments, " "); got != test.want {
				t.Fatalf("arguments %q, want %q", got, test.want)
			}
			if spec.Executable != interpreter {
				t.Fatalf("executable %q", spec.Executable)
			}
		})
	}
}

func TestFrameworkServerValidation(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	for _, test := range []struct {
		name    string
		options Options
		want    string
	}{
		{name: "app without attribute", options: Options{Module: "uvicorn", App: "not a target"}, want: "module:attribute"},
		{name: "missing app", options: Options{Module: "uvicorn"}, want: "module:attribute"},
		{name: "host with a scheme", options: Options{Module: "uvicorn", App: "app:app", Host: "http://localhost"}, want: "host"},
		{name: "port out of range", options: Options{Module: "flask", App: "app", Port: 70000}, want: "port"},
		{name: "guided fields on a plain module", options: Options{Module: "package.main", Port: 8000}, want: "uvicorn or flask"},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.options.Interpreter = interpreter
			data, _ := json.Marshal(test.options)
			err := New().ValidateRunConfiguration(run.Configuration{Language: ID, Kind: "module", LanguageOptions: data})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error %v, want %q", err, test.want)
			}
		})
	}
}

// TestFrameworkDefaultsLeaveThePortToTheServer: con host e porta vuoti il comando non inventa
// valori, così uvicorn mantiene i suoi default.
func TestFrameworkDefaultsLeaveThePortToTheServer(t *testing.T) {
	arguments, ok := serverArguments(Options{Module: "uvicorn", App: "app:app"})
	if !ok || strings.Join(arguments, " ") != "-m uvicorn app:app" {
		t.Fatalf("%v %v", arguments, ok)
	}
}
