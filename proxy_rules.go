// proxy_rules.go — IP/CIDR-based proxy filtering rules using bart.
// Enables allow/block lists, subnet-based interception, and profiles.

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gaissmai/bart"
)

type ProxyRule struct {
	ID      string `json:"id"`
	Type    string `json:"type"`   // "allow", "block", "intercept"
	Target  string `json:"target"` // CIDR or domain (*.internal)
	Enabled bool   `json:"enabled"`
	Note    string `json:"note,omitempty"`
}

type compiledRegexRule struct {
	re       *regexp.Regexp
	ruleType string
}

var (
	proxyRulesMu sync.RWMutex
	proxyRules   = make([]ProxyRule, 0)
	proxyTbl     *bart.Table[string]
	proxyTblMu   sync.RWMutex
	proxyRegex   []compiledRegexRule
	proxyRegexMu sync.RWMutex
	proxyLog     []proxyMatchLog
	proxyLogMu   sync.Mutex
	proxyLogMax  = 200
)

type proxyMatchLog struct {
	Time     string `json:"time"`
	Target   string `json:"target"`
	RuleType string `json:"ruleType"`
	RuleID   string `json:"ruleId"`
	Matched  bool   `json:"matched"`
}

func initProxyRules() {
	proxyTbl = &bart.Table[string]{}
}

func snapshotProxyRules() []ProxyRule {
	proxyRulesMu.RLock()
	rules := make([]ProxyRule, len(proxyRules))
	copy(rules, proxyRules)
	proxyRulesMu.RUnlock()
	return rules
}

func buildCIDRTable(rules []ProxyRule) {
	t := &bart.Table[string]{}
	cidrCount := 0
	compiled := make([]compiledRegexRule, 0)

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if strings.HasPrefix(rule.Target, "/") && strings.HasSuffix(rule.Target, "/") {
			pattern := rule.Target[1 : len(rule.Target)-1]
			re, err := regexp.Compile(pattern)
			if err != nil {
				log.Printf("[proxy-rules] invalid regex %q: %v", pattern, err)
				continue
			}
			compiled = append(compiled, compiledRegexRule{re: re, ruleType: rule.Type})
			continue
		}
		pfx, err := netip.ParsePrefix(rule.Target)
		if err != nil {
			continue
		}
		t.Insert(pfx, rule.Type)
		cidrCount++
	}

	proxyTblMu.Lock()
	proxyTbl = t
	proxyTblMu.Unlock()

	proxyRegexMu.Lock()
	proxyRegex = compiled
	proxyRegexMu.Unlock()

	log.Printf("[proxy-rules] rebuilt: %d CIDR, %d regex rules", cidrCount, len(compiled))
}

func syncBreakpointsFromInterceptRules(rules []ProxyRule) {
	next := make([]string, 0)
	seen := make(map[string]bool)

	for _, rule := range rules {
		if !rule.Enabled || rule.Type != "intercept" || rule.Target == "" || seen[rule.Target] {
			continue
		}
		next = append(next, rule.Target)
		seen[rule.Target] = true
	}

	breakpointsMu.Lock()
	breakpoints = next
	breakpointsMu.Unlock()
}

func matchIP(ipStr string) (bool, string) {
	addr, err := netip.ParseAddr(ipStr)
	if err != nil {
		return false, ""
	}

	proxyTblMu.RLock()
	defer proxyTblMu.RUnlock()

	proxyTbl.AllSorted() // ensure table is built
	// Iterate to find the most specific matching prefix
	var bestVal string
	var bestBits int
	for pfx, val := range proxyTbl.AllSorted() {
		if pfx.Contains(addr) && pfx.Bits() > bestBits {
			bestBits = pfx.Bits()
			bestVal = val
		}
	}
	return bestBits > 0, bestVal
}

func matchDomain(host string) (bool, string) {
	proxyRulesMu.RLock()
	defer proxyRulesMu.RUnlock()
	for _, rule := range proxyRules {
		if !rule.Enabled {
			continue
		}
		if strings.HasPrefix(rule.Target, "*.") {
			suffix := rule.Target[2:]
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				return true, rule.Type
			}
		} else if host == rule.Target {
			return true, rule.Type
		}
	}
	return false, ""
}

// --- HTTP handlers ---

func proxyRulesGetHandler(w http.ResponseWriter, r *http.Request) {
	proxyRulesMu.RLock()
	rules := make([]ProxyRule, len(proxyRules))
	copy(rules, proxyRules)
	proxyRulesMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rules": rules,
		"count": len(rules),
	})
}

func proxyRulesPutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "POST/PUT required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Rules  []ProxyRule `json:"rules"`
		Action string      `json:"action"`
		ID     string      `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	proxyRulesMu.Lock()
	switch req.Action {
	case "set":
		proxyRules = req.Rules
	case "clear":
		proxyRules = nil
	case "delete":
		filtered := make([]ProxyRule, 0)
		for _, r := range proxyRules {
			if r.ID != req.ID {
				filtered = append(filtered, r)
			}
		}
		proxyRules = filtered
	default:
		proxyRules = req.Rules
	}
	proxyRulesMu.Unlock()

	rulesSnapshot := snapshotProxyRules()
	syncBreakpointsFromInterceptRules(rulesSnapshot)
	buildCIDRTable(rulesSnapshot)

	if storeDB != nil {
		data, _ := json.Marshal(rulesSnapshot)
		_ = storePut("proxy", "rules", data)
	}

	w.Header().Set("Content-Type", "application/json")
	proxyRulesMu.RLock()
	ct := len(proxyRules)
	proxyRulesMu.RUnlock()
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "count": ct})
}

func proxyRulesTestHandler(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("target")
	if target == "" {
		http.Error(w, "target required", http.StatusBadRequest)
		return
	}
	ipOk, ipRule := matchIP(target)
	domOk, domRule := matchDomain(target)
	regexOk, regexRule := matchRegex(target)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"target":      target,
		"ipMatch":     ipOk,
		"ipRule":      ipRule,
		"domainMatch": domOk,
		"domainRule":  domRule,
		"regexMatch":  regexOk,
		"regexRule":   regexRule,
	})
}

func matchRegex(host string) (bool, string) {
	proxyRegexMu.RLock()
	defer proxyRegexMu.RUnlock()
	for _, cr := range proxyRegex {
		if cr.re.MatchString(host) {
			return true, cr.ruleType
		}
	}
	return false, ""
}

func proxyRulesLogHandler(w http.ResponseWriter, r *http.Request) {
	proxyLogMu.Lock()
	logs := make([]proxyMatchLog, len(proxyLog))
	copy(logs, proxyLog)
	proxyLogMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"log":   logs,
		"count": len(logs),
	})
}

func timeNowStr() string {
	return time.Now().UTC().Format(time.RFC3339)
}
