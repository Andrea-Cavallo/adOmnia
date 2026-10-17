package run

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
)

// batchUnsafe sono i caratteri che `cmd.exe` interpreta (o che rompono il quoting) quando un .cmd riceve gli argomenti.
const batchUnsafe = " \t\r\n&|<>^%!\"`"

// CheckBatchSafe rifiuta gli argomenti che un programma installato come .cmd/.bat (npm.cmd, mvnw.cmd)
// non può ricevere in sicurezza: Windows li rilegge con cmd.exe, quindi `&` in un nome di test diventerebbe un comando.
func CheckBatchSafe(binary string, arguments []string) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	if extension := strings.ToLower(filepath.Ext(binary)); extension != ".cmd" && extension != ".bat" {
		return nil
	}
	for _, argument := range arguments {
		if index := strings.IndexAny(argument, batchUnsafe); index >= 0 {
			return fmt.Errorf("the argument %q contains %q, which Windows cannot pass safely to %s: run the whole test file instead", argument, argument[index], filepath.Base(binary))
		}
	}
	return nil
}
