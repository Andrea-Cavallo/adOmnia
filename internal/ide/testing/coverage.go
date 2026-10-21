package testing

// CoverageBlock è un intervallo di righe con lo stesso esito di copertura. Le colonne sono 1-based
// come nell'editor; per la copertura a istruzioni (Python) un blocco copre una sola riga.
type CoverageBlock struct {
	StartLine   int  `json:"startLine"`
	StartColumn int  `json:"startColumn"`
	EndLine     int  `json:"endLine"`
	EndColumn   int  `json:"endColumn"`
	Covered     bool `json:"covered"`
	Statements  int  `json:"statements"`
}

// CoverageFile è la copertura di un file del progetto.
type CoverageFile struct {
	// Path è il percorso relativo alla radice del progetto, in forma slash.
	Path       string          `json:"path"`
	Statements int             `json:"statements"`
	Covered    int             `json:"covered"`
	Percent    float64         `json:"percent"`
	Blocks     []CoverageBlock `json:"blocks"`
}

// CoverageReport è il risultato di uno strumento di copertura, in forma neutra rispetto al
// linguaggio: il core non conosce profili Go né report di pytest-cov.
type CoverageReport struct {
	// Mode è l'origine del report ("set", "pytest-cov", …), mostrata nella vista.
	Mode       string         `json:"mode"`
	Statements int            `json:"statements"`
	Covered    int            `json:"covered"`
	Percent    float64        `json:"percent"`
	Files      []CoverageFile `json:"files"`
}

// CoverageProvider è una capability opzionale del parser: restituisce il report dell'esecuzione
// appena conclusa. È chiamata una volta, quando il processo termina; nil se il run non ha
// prodotto copertura.
type CoverageProvider interface {
	Coverage() *CoverageReport
}

func cloneCoverage(report *CoverageReport) *CoverageReport {
	if report == nil {
		return nil
	}
	clone := *report
	clone.Files = make([]CoverageFile, len(report.Files))
	for index, file := range report.Files {
		clone.Files[index] = file
		clone.Files[index].Blocks = append([]CoverageBlock(nil), file.Blocks...)
	}
	return &clone
}
