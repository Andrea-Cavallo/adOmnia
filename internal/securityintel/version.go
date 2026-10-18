package securityintel

import (
	"strconv"
	"strings"
	"unicode"
)

// compareVersions confronta due stringhe di versione con semantica naturale.
//
// È il confronto che il motore usa per dire "questa versione è già corretta": se
// sbaglia, il finding sparisce o resta quando non deve. Non usa una semantica
// ecosistema-specifica perché lo stesso confronto serve a Maven e a Go: i token
// numerici si confrontano numericamente, i qualificatori con una tabella di ordine
// (Maven ComparableVersion) e la parte mancante vale zero.
//
// Ritorna -1 se a < b, 0 se equivalenti, 1 se a > b.
func compareVersions(left, right string) int {
	a := tokenizeVersion(left)
	b := tokenizeVersion(right)
	max := len(a)
	if len(b) > max {
		max = len(b)
	}
	for index := 0; index < max; index++ {
		var tokenA, tokenB versionToken
		if index < len(a) {
			tokenA = a[index]
		}
		if index < len(b) {
			tokenB = b[index]
		}
		if comparison := compareVersionToken(tokenA, tokenB); comparison != 0 {
			return comparison
		}
	}
	return 0
}

// versionToken è un pezzo di versione: numerico o testuale.
type versionToken struct {
	numeric bool
	number  int
	text    string
}

// tokenizeVersion spezza una versione nei suoi token, ignorando i separatori.
// "1.2.3-rc.1" → [1, 2, 3, "rc", 1].
func tokenizeVersion(version string) []versionToken {
	tokens := []versionToken{}
	runes := []rune(strings.TrimSpace(version))
	// Un prefisso "v" (Go) non è parte della versione.
	if len(runes) > 0 && (runes[0] == 'v' || runes[0] == 'V') {
		runes = runes[1:]
	}
	index := 0
	for index < len(runes) {
		char := runes[index]
		switch {
		case char == '.' || char == '-' || char == '_' || char == '+':
			index++
		case unicode.IsDigit(char):
			start := index
			for index < len(runes) && unicode.IsDigit(runes[index]) {
				index++
			}
			digits := string(runes[start:index])
			number, _ := strconv.Atoi(digits)
			tokens = append(tokens, versionToken{numeric: true, number: number})
		case unicode.IsLetter(char):
			start := index
			for index < len(runes) && unicode.IsLetter(runes[index]) {
				index++
			}
			tokens = append(tokens, versionToken{text: strings.ToLower(string(runes[start:index]))})
		default:
			index++
		}
	}
	return trimTrailingZeroes(tokens)
}

// trimTrailingZeroes toglie gli zeri finali: "1.0" e "1" sono la stessa versione.
// Senza questo, "1.0.0" risulterebbe più recente di "1" e una correzione applicata
// verrebbe scambiata per non applicata.
func trimTrailingZeroes(tokens []versionToken) []versionToken {
	end := len(tokens)
	for end > 0 {
		token := tokens[end-1]
		if token.numeric && token.number == 0 {
			end--
			continue
		}
		if !token.numeric && token.text == "" {
			end--
			continue
		}
		break
	}
	return tokens[:end]
}

// compareVersionToken confronta un token mancante come se fosse zero o vuoto.
func compareVersionToken(left, right versionToken) int {
	// Un token numerico è più "recente" di uno testuale a parità di posizione: Maven
	// considera "1.0" più recente di "1.0-alpha".
	if left.numeric != right.numeric {
		if isMissing(left) || isMissing(right) {
			return compareMissing(left, right)
		}
		if left.numeric {
			return 1
		}
		return -1
	}
	if left.numeric {
		switch {
		case left.number < right.number:
			return -1
		case left.number > right.number:
			return 1
		default:
			return 0
		}
	}
	return compareQualifiers(left.text, right.text)
}

// isMissing dice se un token è quello "assente" usato per allineare le lunghezze.
func isMissing(token versionToken) bool {
	return !token.numeric && token.text == "" && token.number == 0
}

// compareMissing gestisce l'allineamento fra un token presente e uno assente.
// Un token assente vale zero, ma un numero è sempre più recente di un qualificatore.
func compareMissing(left, right versionToken) int {
	missingLeft := isMissing(left)
	missingRight := isMissing(right)
	switch {
	case missingLeft && missingRight:
		return 0
	case missingLeft:
		if right.numeric {
			if right.number == 0 {
				return 0
			}
			return -1
		}
		// Un qualificatore è sempre meno recente della versione "pura".
		return 1
	default:
		if left.numeric {
			if left.number == 0 {
				return 0
			}
			return 1
		}
		return -1
	}
}

// qualifierRank ordina i qualificatori come fa Maven ComparableVersion.
// alpha < beta < milestone < rc < snapshot < (vuoto) < sp, poi gli altri per ordine
// alfabetico dopo quelli noti.
func qualifierRank(qualifier string) int {
	switch qualifier {
	case "alpha", "a":
		return 1
	case "beta", "b":
		return 2
	case "milestone", "m":
		return 3
	case "rc", "cr":
		return 4
	case "snapshot":
		return 5
	case "":
		return 6
	case "ga", "final", "release", "sp":
		return 7
	}
	return 8
}

// compareQualifiers confronta due qualificatori secondo l'ordine Maven.
func compareQualifiers(left, right string) int {
	leftRank := qualifierRank(left)
	rightRank := qualifierRank(right)
	if leftRank != rightRank {
		if leftRank < rightRank {
			return -1
		}
		return 1
	}
	if left == right {
		return 0
	}
	if left < right {
		return -1
	}
	return 1
}

// CompareVersions è la versione esportata del confronto: gli adapter la usano per
// decidere se un aggiornamento è compatibile.
func CompareVersions(left, right string) int {
	return compareVersions(left, right)
}

// VersionRangeMatch dice se una versione cade in un intervallo del tipo
// "[1.0,2.0)", ">= 1.2", "< 2.0". Gli intervalli sono quelli che gli advisory
// esprimono in OSV e che Maven usa nel dependencyManagement.
func VersionRangeMatch(version, expression string) bool {
	expression = strings.TrimSpace(expression)
	if expression == "" {
		return true
	}
	// Intervallo chiuso/aperto: "[1.0,2.0)" o "(,1.0]".
	if strings.HasPrefix(expression, "[") || strings.HasPrefix(expression, "(") {
		open := expression[0] == '('
		closed := strings.HasSuffix(expression, "]")
		body := strings.TrimSuffix(strings.TrimPrefix(expression, string(expression[0])), ")")
		body = strings.TrimSuffix(body, "]")
		lower, upper, hasComma := strings.Cut(body, ",")
		if !hasComma {
			// "[1.0]" è una versione esatta.
			return compareVersions(version, strings.TrimSpace(lower)) == 0
		}
		lower = strings.TrimSpace(lower)
		upper = strings.TrimSpace(upper)
		if lower != "" {
			comparison := compareVersions(version, lower)
			if comparison < 0 || (comparison == 0 && open) {
				return false
			}
		}
		if upper != "" {
			comparison := compareVersions(version, upper)
			if comparison > 0 || (comparison == 0 && !closed) {
				return false
			}
		}
		return true
	}
	// Espressione con operatore: ">= 1.2", "< 2.0", "= 1.2.3".
	for _, operator := range []string{">=", "<=", "==", "!=", ">", "<", "="} {
		if strings.HasPrefix(expression, operator) {
			target := strings.TrimSpace(expression[len(operator):])
			comparison := compareVersions(version, target)
			switch operator {
			case ">=":
				return comparison >= 0
			case "<=":
				return comparison <= 0
			case "==", "=":
				return comparison == 0
			case "!=":
				return comparison != 0
			case ">":
				return comparison > 0
			case "<":
				return comparison < 0
			}
		}
	}
	// Nessun operatore: una singola versione significa "questa versione o più recente".
	return compareVersions(version, expression) >= 0
}

// CompatibilityClassOf classifica il rischio di rottura di un aggiornamento
// confrontando la versione corrente con la versione corretta.
func CompatibilityClassOf(current, fixed string) string {
	currentTokens := tokenizeVersion(current)
	fixedTokens := tokenizeVersion(fixed)
	if len(currentTokens) == 0 || len(fixedTokens) == 0 {
		return CompatibilityUnknown
	}
	if !currentTokens[0].numeric || !fixedTokens[0].numeric {
		return CompatibilityUnknown
	}
	switch {
	case fixedTokens[0].number > currentTokens[0].number:
		return CompatibilityMajor
	case len(fixedTokens) > 1 && len(currentTokens) > 1 && fixedTokens[1].numeric && currentTokens[1].numeric && fixedTokens[1].number > currentTokens[1].number:
		return CompatibilityMinor
	default:
		return CompatibilityPatch
	}
}
