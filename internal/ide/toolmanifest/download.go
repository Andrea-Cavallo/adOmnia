package toolmanifest

import (
	"runtime"
	"strings"
)

// Download describes a pinned archive that an installer downloads into directory/extract.
type Download struct {
	Directory string // tools folder of this tool and version
	Archive   string // local file name; ".zip" is unzipped, anything else is a .tar.gz (unless Binary)
	// Binary: the download is the executable itself (no archive); it is kept as extract/<Archive>.
	Binary bool
	URL    string
	SHA256 string
	Report string // install report written after the checksum passed
	// Executables are paths under extract/ made executable on macOS and Linux (zip drops the bit).
	Executables []string
}

// Command is the one visible command that downloads the archive, verifies its SHA-256 before
// extracting it, then writes the install report: PowerShell on Windows (tar.exe ships with
// Windows 10 1803+), sh + curl + sha256sum/shasum elsewhere. It never installs anything globally.
func (d Download) Command() (string, []string) {
	if runtime.GOOS == "windows" {
		return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-Command", d.powershell()}
	}
	return "sh", []string{"-c", d.posix()}
}

func (d Download) zip() bool { return strings.HasSuffix(strings.ToLower(d.Archive), ".zip") }

func (d Download) powershell() string {
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	file, extract := "$f=Join-Path $d "+quote(d.Archive)+"; ", "Expand-Archive -Force $f $e; Remove-Item $f; "
	switch {
	case d.Binary:
		file, extract = "New-Item -ItemType Directory -Force -Path $e | Out-Null; $f=Join-Path $e "+quote(d.Archive)+"; ", ""
	case !d.zip():
		extract = "New-Item -ItemType Directory -Force -Path $e | Out-Null; tar -xzf $f -C $e; Remove-Item $f; "
	}
	return "$ErrorActionPreference='Stop'; $d=" + quote(d.Directory) + "; $e=Join-Path $d 'extract'; " + file +
		"Invoke-WebRequest -UseBasicParsing " + quote(d.URL) + " -OutFile $f; " +
		"if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne '" + d.SHA256 + "') { Remove-Item $f; throw 'SHA-256 mismatch: the download was discarded' }; " +
		extract +
		"Set-Content -LiteralPath (Join-Path $d " + quote(ReportFile) + ") -Value " + quote(d.Report)
}

func (d Download) posix() string {
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'" }
	check := "sha256sum -c -"
	if runtime.GOOS == "darwin" {
		check = "shasum -a 256 -c -"
	}
	file := `"$d/` + d.Archive + `"`
	extract := `mkdir -p "$d/extract"; tar -xzf ` + file + ` -C "$d/extract"; rm -f ` + file + "; "
	switch {
	case d.Binary:
		file, extract = `"$d/extract/`+d.Archive+`"`, ""
	case d.zip():
		extract = "unzip -oq " + file + ` -d "$d/extract"; rm -f ` + file + "; "
	}
	var chmod strings.Builder
	for _, executable := range d.Executables {
		chmod.WriteString(`chmod +x "$d/extract/` + executable + `"; `)
	}
	return "set -e; d=" + quote(d.Directory) + `; mkdir -p "$d/extract"; curl -fsSL ` + quote(d.URL) + " -o " + file + "; " +
		"echo '" + d.SHA256 + "  '" + file + " | " + check + "; " +
		extract + chmod.String() +
		"printf '%s' " + quote(d.Report) + ` >"$d/` + ReportFile + `"`
}
