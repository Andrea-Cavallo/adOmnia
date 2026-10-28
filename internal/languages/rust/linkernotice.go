package rust

import "regexp"

// missingLinkerLine riconosce un build fallito perché manca il linker MSVC: la toolchain
// `*-pc-windows-msvc` ha bisogno dei Microsoft C++ Build Tools, che portano `link.exe` e la
// Windows SDK. Due forme reali: rustc/rustup (`error: linker `link.exe` not found`, anche col
// percorso configurato in `.cargo/config.toml`) e il linker presente ma senza SDK
// (`LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'`). L'errore grezzo non dice
// cosa installare, quindi va spiegato (RS-2.2, RS-M10).
var missingLinkerLine = regexp.MustCompile("(?i)(linker [`\"']?[^`\"']*link\\.exe[`\"']? not found|lnk1181|cannot open input file ['\"]?kernel32\\.lib)")

// missingLinkerExplanation è la spiegazione mostrata una sola volta per esecuzione, subito dopo
// l'errore: il rimedio è un'installazione dell'utente, che adOmnia non fa al posto suo.
const missingLinkerExplanation = "the MSVC toolchain needs the Microsoft C++ Build Tools: install Visual Studio Build Tools with the \"Desktop development with C++\" workload (it provides link.exe and the Windows SDK), then reopen adOmnia so the new PATH is picked up. adOmnia does not install them for you. Another option is a *-pc-windows-gnu toolchain, which needs MinGW instead."
