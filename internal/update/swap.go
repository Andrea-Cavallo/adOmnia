package update

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// renameFile è sostituibile nei test per simulare file bloccati (antivirus, OneDrive, indicizzatori).
var renameFile = os.Rename

// installSwap sostituisce l'installazione e sa tornare indietro. Due casi reali: l'eseguibile singolo
// (Windows, Linux) e il bundle .app di macOS, che è una cartella e non si può rinominare sopra l'esistente.
type installSwap interface {
	// backup conserva una copia ripristinabile dell'installazione attuale.
	backup() error
	// install mette al suo posto la nuova versione.
	install(source string) error
	// restore rimette la versione salvata da backup.
	restore() error
	// finish elimina il backup dopo che la nuova versione ha confermato l'avvio.
	finish()
}

func newInstallSwap(target, backup string) installSwap {
	if info, err := os.Stat(target); err == nil && info.Mode().IsRegular() {
		return &fileSwap{target: target, backupPath: backup, mode: info.Mode().Perm()}
	}
	return &bundleSwap{target: target, backupPath: backup}
}

// fileSwap non rimuove mai l'eseguibile installato: il backup è una copia e la nuova versione entra
// con un rename atomico sopra il file esistente (MoveFileEx con REPLACE_EXISTING su Windows). In ogni
// istante il percorso dell'app contiene una versione avviabile, anche se un passo fallisce.
type fileSwap struct {
	target     string
	backupPath string
	mode       os.FileMode
}

func (s *fileSwap) backup() error {
	if err := removeWithRetry(s.backupPath, fileReleaseTimeout); err != nil {
		return fmt.Errorf("cannot clear the previous backup: %w", err)
	}
	if err := copyRegular(s.target, s.backupPath, s.mode); err != nil {
		return fmt.Errorf("cannot back up the installed app: %w", err)
	}
	return nil
}

func (s *fileSwap) install(source string) error { return replaceInPlace(source, s.target, s.mode) }

func (s *fileSwap) restore() error { return replaceInPlace(s.backupPath, s.target, s.mode) }

func (s *fileSwap) finish() { _ = os.Remove(s.backupPath) }

// replaceInPlace copia source accanto a target (stessa cartella, quindi stesso volume) e lo rinomina
// sopra target. source resta intatto: può servire ancora per un ripristino.
func replaceInPlace(source, target string, mode os.FileMode) error {
	staged := filepath.Join(filepath.Dir(target), "."+filepath.Base(target)+".update")
	if err := removeWithRetry(staged, fileReleaseTimeout); err != nil {
		return fmt.Errorf("cannot clear a stale staged update: %w", err)
	}
	if err := copyRegular(source, staged, mode); err != nil {
		_ = os.Remove(staged)
		return fmt.Errorf("cannot stage the app next to %s: %w", target, err)
	}
	if err := renameWithRetry(staged, target); err != nil {
		_ = os.Remove(staged)
		return fmt.Errorf("cannot replace %s (is it still running or locked by an antivirus?): %w", target, err)
	}
	return nil
}

// renameWithRetry ritenta mentre Windows rilascia l'immagine del processo appena chiuso o un antivirus
// finisce la scansione del file.
func renameWithRetry(source, target string) error {
	deadline := time.Now().Add(fileReleaseTimeout)
	for {
		err := renameFile(source, target)
		if err == nil || time.Now().After(deadline) {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// bundleSwap sposta l'intero bundle: una cartella non si sostituisce con un rename atomico.
type bundleSwap struct {
	target     string
	backupPath string
}

func (s *bundleSwap) backup() error { return movePath(s.target, s.backupPath) }

func (s *bundleSwap) install(source string) error { return movePath(source, s.target) }

func (s *bundleSwap) restore() error {
	if err := removeWithRetry(s.target, fileReleaseTimeout); err != nil {
		return fmt.Errorf("cannot remove failed update; previous app retained at %s: %w", s.backupPath, err)
	}
	if err := movePath(s.backupPath, s.target); err != nil {
		return fmt.Errorf("cannot restore previous app at %s: %w", s.backupPath, err)
	}
	return nil
}

func (s *bundleSwap) finish() { _ = os.RemoveAll(s.backupPath) }
