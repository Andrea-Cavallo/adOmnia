package codestudio

import (
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/idetest"
)

const fakeGoplsEnv = idetest.FakeGoplsEnv

// I test leggono le unità subito dopo OpenProject: attesa lunga = detection sincrona come prima.
// Il percorso asincrono ha il suo test, che abbassa detectWait sulla singola sessione.
func TestMain(m *testing.M) {
	defaultDetectionWait = time.Minute
	// Nessun warm dell'indice in background: i test contano le costruzioni e cancellano le TempDir.
	defaultIndexWarmDelay = 0
	// Nessuna nuova detection delle sessioni ripristinate: la prova la abilita da sé.
	restoredDetectionDelay = 0
	idetest.Main(m)
}
