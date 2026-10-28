// Package fileio raccoglie le scritture su disco condivise dalle funzioni dell'IDE.
package fileio

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// RenameFile è sostituibile nei test; saveRenameAttempts e saveRenameBackoff gestiscono i blocchi momentanei di Windows.
var RenameFile = os.Rename

const (
	saveRenameAttempts = 5
	saveRenameBackoff  = 25 * time.Millisecond
)

// replaceFile sostituisce path con temporaryPath. Su Windows antivirus, indicizzatori e gopls tengono il file
// aperto per pochi millisecondi: si riprova con backoff prima di rinunciare.
func replaceFile(temporaryPath, path string) error {
	var err error
	for attempt := range saveRenameAttempts {
		if err = RenameFile(temporaryPath, path); err == nil {
			return nil
		}
		time.Sleep(saveRenameBackoff << attempt)
	}
	return fmt.Errorf("the file is locked by another program (antivirus, indexer or language server): retry in a moment (%w)", err)
}

// AtomicWriteFile scrive data in path senza lasciare mai un file a metà: file temporaneo nella stessa
// cartella, sync e rename. I symlink si scrivono attraverso.
func AtomicWriteFile(path string, data []byte, mode os.FileMode) error {
	// Un symlink si scrive attraverso: sostituirlo con un file regolare lo staccherebbe dal suo target.
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".adomnia-save-*")
	if err != nil {
		return fmt.Errorf("could not prepare the save: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("could not preserve the file permissions: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("writing the document failed: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("synchronizing the document failed: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("closing the temporary document failed: %w", err)
	}
	if err := replaceFile(temporaryPath, path); err != nil {
		return fmt.Errorf("saving the document failed: %w", err)
	}
	return nil
}
