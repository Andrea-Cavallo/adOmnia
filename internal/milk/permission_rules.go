package milk

import (
	"fmt"
	"strings"
)

// Permission categories group the ACP tool kinds the user decides about separately.
const (
	PermissionRead    = "read"
	PermissionWrite   = "write"
	PermissionShell   = "shell"
	PermissionNetwork = "network"
	PermissionOther   = "other"
)

// Rules for a category: ask the user (default), allow or deny without asking.
const (
	RuleAsk   = "ask"
	RuleAllow = "allow"
	RuleDeny  = "deny"
)

var permissionCategories = []string{PermissionRead, PermissionWrite, PermissionShell, PermissionNetwork, PermissionOther}

// permissionCategory maps an ACP tool kind (read, edit, delete, move, search, execute,
// fetch, think, switch_mode, other) to the category the user configured.
func permissionCategory(toolKind string) string {
	switch strings.ToLower(strings.TrimSpace(toolKind)) {
	case "read", "search":
		return PermissionRead
	case "edit", "delete", "move":
		return PermissionWrite
	case "execute":
		return PermissionShell
	case "fetch":
		return PermissionNetwork
	default:
		return PermissionOther
	}
}

func validatePermissionRules(rules map[string]string) (map[string]string, error) {
	clean := make(map[string]string, len(rules))
	for category, rule := range rules {
		category = strings.ToLower(strings.TrimSpace(category))
		rule = strings.ToLower(strings.TrimSpace(rule))
		known := false
		for _, candidate := range permissionCategories {
			known = known || candidate == category
		}
		if !known {
			return nil, fmt.Errorf("unknown permission category %q", category)
		}
		switch rule {
		case RuleAsk:
			continue // the default: nothing to store
		case RuleAllow, RuleDeny:
			clean[category] = rule
		default:
			return nil, fmt.Errorf("permission rule for %s must be ask, allow or deny", category)
		}
	}
	return clean, nil
}

// permissionDecision decides a request without asking, or returns RuleAsk. An explicit
// deny wins even over "skip permissions": the user denied that category on purpose.
func (s Settings) permissionDecision(category string) string {
	rule := s.PermissionRules[category]
	switch {
	case rule == RuleDeny:
		return RuleDeny
	case s.SkipPermissions || rule == RuleAllow:
		return RuleAllow
	default:
		return RuleAsk
	}
}

// AutoPermissionEvent records a permission decided by a rule, so the decision is visible
// (chat, Agent Task timeline) even though nobody was asked.
type AutoPermissionEvent struct {
	SessionID  string `json:"sessionId"`
	SessionKey string `json:"sessionKey,omitempty"`
	Title      string `json:"title"`
	Category   string `json:"category"`
	Outcome    string `json:"outcome"`
}
