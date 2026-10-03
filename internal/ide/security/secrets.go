package security

import (
	"path"
	"regexp"
	"strings"
)

// Regola dei segreti: vale per ogni linguaggio e per i file di configurazione.
const (
	RuleHardcodedSecret = "secret/hardcoded"
	RulePrivateKey      = "secret/private-key"
	categorySecrets     = "Secrets"
)

// secretPattern è un formato di credenziale ad alta precisione (stessi pattern della redazione AI).
type secretPattern struct {
	name    string
	pattern *regexp.Regexp
	rule    string
}

var secretPatterns = []secretPattern{
	{"private key", regexp.MustCompile(`-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----`), RulePrivateKey},
	{"AWS access key", regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`), RuleHardcodedSecret},
	{"GitHub token", regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{36,}\b`), RuleHardcodedSecret},
	{"GitLab token", regexp.MustCompile(`\bglpat-[A-Za-z0-9\-_]{20,}\b`), RuleHardcodedSecret},
	{"Stripe key", regexp.MustCompile(`\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b`), RuleHardcodedSecret},
	{"OpenAI/Anthropic key", regexp.MustCompile(`\bsk-(?:proj-|ant-)?[A-Za-z0-9\-_]{32,}\b`), RuleHardcodedSecret},
	{"Slack token", regexp.MustCompile(`\bxox[bprs]-[A-Za-z0-9-]{10,}\b`), RuleHardcodedSecret},
	{"Google API key", regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{35}\b`), RuleHardcodedSecret},
	{"JSON Web Token", regexp.MustCompile(`\beyJ[A-Za-z0-9\-_]{20,}\.eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{10,}`), RuleHardcodedSecret},
	{"password in connection string", regexp.MustCompile(`(?i)\b(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis|rediss|amqps?|mssql|sqlserver)://[^:@\s/"'` + "`" + `]+:([^@\s"'` + "`" + `$]{3,})@`), RuleHardcodedSecret},
}

// sensitiveAssignment trova stringhe assegnate a nomi sensibili: password := "x", APIKey: "x".
var sensitiveAssignment = regexp.MustCompile(`(?i)\b([A-Za-z_]*(?:password|passwd|secret|token|apikey|api_key|accesskey|access_key|privatekey|private_key|client_secret)[A-Za-z_0-9]*)["']?\s*(?::=|=|:)\s*["'` + "`" + `]([^"'` + "`" + `\n]{8,})["'` + "`" + `]`)

// labelSuffixes dopo la parola sensibile indicano un'etichetta, non un segreto: tokenKey, tokenUrl, passwordField.
var labelSuffixes = regexp.MustCompile(`(?i)(?:key|keys|url|uri|endpoint|header|name|field|path|env|var|label|type|id|prefix|param|file|kind|mode|placeholder|hint|length|len|regex|pattern|format|expiry|ttl)$`)

var sensitiveWord = regexp.MustCompile(`(?i)password|passwd|secret|token|apikey|api_key|accesskey|access_key|privatekey|private_key|client_secret`)

// pemBody riconosce il contenuto base64 di una chiave PEM (righe da 64 caratteri, o "\n" dentro una stringa).
var pemBody = regexp.MustCompile(`[A-Za-z0-9+/]{40,}`)

// placeholderValue riconosce valori che non sono segreti veri: esempi, variabili, riferimenti.
var placeholderValue = regexp.MustCompile(`(?i)^(?:x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[sv]|changeme|change[-_]?me|example|password|secret|token|guest|admin|root|postgres|mysql|redis|user|your[-_ ].*|test.*|dummy.*|fake.*|sample.*|placeholder.*|redacted.*|todo.*|xxx.*|env:.*|vault:.*)$`)

// looksRandom: un segreto vero mescola cifre, maiuscole o simboli; parole minuscole sono etichette o default di sviluppo.
func looksRandom(value string) bool {
	var lower, upper, digit, symbol bool
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			lower = true
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= '0' && r <= '9':
			digit = true
		default:
			symbol = true
		}
	}
	classes := 0
	for _, present := range []bool{lower, upper, digit, symbol} {
		if present {
			classes++
		}
	}
	return digit && classes >= 2 || classes >= 3
}

// labelName dice se il nome assegnato è un'etichetta (tokenKey, passwordField) e non il segreto stesso.
func labelName(name string) bool {
	locations := sensitiveWord.FindAllStringIndex(name, -1)
	if len(locations) == 0 {
		return false
	}
	suffix := name[locations[len(locations)-1][1]:]
	return suffix != "" && labelSuffixes.MatchString(suffix)
}

// secretFileExtensions: file di testo dove un segreto può finire per sbaglio.
var secretFileExtensions = map[string]bool{
	".go": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true, ".py": true, ".java": true, ".kt": true, ".rb": true, ".php": true, ".cs": true, ".rs": true,
	".json": true, ".yaml": true, ".yml": true, ".toml": true, ".ini": true, ".cfg": true, ".conf": true, ".properties": true, ".xml": true,
	".env": true, ".sh": true, ".ps1": true, ".tf": true, ".tfvars": true, ".sql": true, ".md": true, ".txt": true, ".pem": true, ".key": true,
}

// SecretsAnalyzer cerca credenziali scritte nei file del progetto.
type SecretsAnalyzer struct{}

func (SecretsAnalyzer) Rules() []Rule {
	return []Rule{
		{ID: RuleHardcodedSecret, Category: categorySecrets, Severity: SeverityHigh, Title: "Hardcoded secret",
			Description: "A credential (token, API key, password) is written in a project file and ends up in Git history and in every copy of the code.",
			Remediation: "Remove it, rotate the credential, and read it from the environment or a secret store at runtime."},
		{ID: RulePrivateKey, Category: categorySecrets, Severity: SeverityHigh, Title: "Private key in the repository",
			Description: "A private key is committed with the code: anyone with the repository can impersonate its owner.",
			Remediation: "Delete the key from the repository and its history, revoke it, and load keys from a secured path or secret store."},
	}
}

func (SecretsAnalyzer) Accepts(relativePath string) bool {
	name := strings.ToLower(path.Base(relativePath))
	if isTestPath(strings.ToLower(relativePath)) || strings.Contains(name, ".example") || strings.Contains(name, ".sample") || strings.HasSuffix(name, ".lock") || name == "go.sum" || name == "package-lock.json" {
		return false
	}
	if strings.HasPrefix(name, ".env") {
		return true
	}
	return secretFileExtensions[path.Ext(name)]
}

func (SecretsAnalyzer) Analyze(relativePath string, content []byte) []Finding {
	var findings []Finding
	lines := strings.Split(string(content), "\n")
	for index, line := range lines {
		number := index + 1
		reported := false
		for _, candidate := range secretPatterns {
			match := candidate.pattern.FindStringSubmatchIndex(line)
			if match == nil {
				continue
			}
			secret := line[match[0]:match[1]]
			if len(match) >= 4 && match[2] >= 0 {
				secret = line[match[2]:match[3]]
			}
			if placeholderValue.MatchString(secret) {
				continue
			}
			if candidate.rule == RulePrivateKey && !pemBody.MatchString(line[match[1]:]) && !pemBody.MatchString(nextLine(lines, index)) {
				continue // cita solo l'intestazione (un messaggio, un placeholder): nessuna chiave dopo
			}
			if candidate.name == "password in connection string" && !looksRandom(secret) {
				continue
			}
			findings = append(findings, secretFinding(candidate.rule, "Possible "+candidate.name+" written in the file.", number, match[0], line, secret))
			reported = true
			break
		}
		if reported {
			continue
		}
		match := sensitiveAssignment.FindStringSubmatchIndex(line)
		if match == nil {
			continue
		}
		name, value := line[match[2]:match[3]], line[match[4]:match[5]]
		if placeholderValue.MatchString(value) || labelName(name) || !looksRandom(value) || strings.Contains(value, " ") {
			continue
		}
		findings = append(findings, secretFinding(RuleHardcodedSecret, "A string literal is assigned to a credential-like name.", number, match[0], line, value))
	}
	return findings
}

func secretFinding(rule, message string, line, column int, text, secret string) Finding {
	severity, title := SeverityHigh, "Hardcoded secret"
	if rule == RulePrivateKey {
		title = "Private key in the repository"
	}
	return Finding{Rule: rule, Category: categorySecrets, Severity: severity, Title: title, Message: message, Line: line, Column: column + 1, Snippet: truncateRunes(strings.TrimSpace(MaskSecret(text, secret)), maxSnippetRunes)}
}

// MaskSecret lascia leggibili i primi 4 caratteri del segreto e nasconde il resto.
func MaskSecret(text, secret string) string {
	if len(secret) <= 4 {
		return strings.ReplaceAll(text, secret, "****")
	}
	return strings.ReplaceAll(text, secret, secret[:4]+strings.Repeat("•", 8))
}

func nextLine(lines []string, index int) string {
	if index+1 < len(lines) {
		return lines[index+1]
	}
	return ""
}

// isTestPath: i test contengono segreti finti per scelta (fixture della redazione, esempi).
func isTestPath(relative string) bool {
	name := path.Base(relative)
	for _, suffix := range []string{"_test.go", ".test.ts", ".test.tsx", ".test.js", ".spec.ts", ".spec.js", "_test.py", "_spec.rb"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return strings.HasPrefix(name, "test_") && strings.HasSuffix(name, ".py") || strings.Contains("/"+relative, "/__tests__/") || strings.Contains("/"+relative, "/fixtures/")
}
