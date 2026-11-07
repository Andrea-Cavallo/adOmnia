package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/project"

// LanguageLibrary è una riga di External Libraries per un linguaggio senza un repository Maven/Go:
// Python (pacchetti installati) e C/C++ (dipendenze CMake/FetchContent/vcpkg/Conan).
type LanguageLibrary struct {
	Name string `json:"name"`
	// Version è quella installata o dichiarata (può essere vuota per una libreria di sistema).
	Version string `json:"version,omitempty"`
	// Scope è "dev" per le dipendenze di sviluppo Python; vuoto per il runtime.
	Scope string `json:"scope,omitempty"`
	// Direct è vero quando il manifest del progetto la dichiara; false per una transitiva.
	Direct bool `json:"direct"`
	// Module è la cartella dell'unità che la dichiara/installa, relativa al progetto ("" per la radice).
	Module string `json:"module,omitempty"`
	// Kind dice da dove arriva: "site-packages", "cmake", "fetchcontent", "vcpkg", "conan", "meson"…
	Kind string `json:"kind,omitempty"`
	// Directory è il codice da sfogliare, assoluto; vuoto quando non c'è (libreria di sistema, pacchetto
	// dichiarato ma non installato).
	Directory string `json:"directory,omitempty"`
	// Available dice se la riga si può espandere e leggere.
	Available bool `json:"available"`
	// Note spiega perché il codice non c'è o come è stata risolta la versione.
	Note string `json:"note,omitempty"`
}

// LanguageLibraries è il risultato di External Libraries per Python e C/C++.
type LanguageLibraries struct {
	Language  string            `json:"language"`
	Libraries []LanguageLibrary `json:"libraries"`
	Warnings  []string          `json:"warnings"`
}

// languageUnits sono le unità del workspace per un adapter linguistico, radice prima.
func languageUnits(workspaceProject Project, languageID string) []project.Unit {
	var units []project.Unit
	for _, unit := range workspaceProject.Units {
		if unit.Language == languageID && unit.Root != "" {
			units = append(units, unit)
		}
	}
	return units
}
