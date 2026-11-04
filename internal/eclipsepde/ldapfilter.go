package eclipsepde

import (
	"fmt"
	"path"
	"strings"
)

// ldapFilter is an OSGi/p2 filter such as `(&(osgi.os=linux)(osgi.arch=x86_64))`:
// p2 uses it for platform-specific units and for the artifact mapping rules.
type ldapFilter struct {
	op       byte // '&', '|', '!' or '=' / '~' / '>' / '<' for a comparison
	children []*ldapFilter
	attr     string
	value    string
}

// parseLDAPFilter parses the filter; an empty string matches everything.
func parseLDAPFilter(text string) (*ldapFilter, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	parser := &filterParser{text: text}
	filter, err := parser.filter()
	if err != nil {
		return nil, err
	}
	parser.skipSpaces()
	if parser.pos != len(parser.text) {
		return nil, fmt.Errorf("invalid filter %q: unexpected text after position %d", text, parser.pos)
	}
	return filter, nil
}

// matches evaluates the filter: a nil filter or nil properties (every platform)
// match, a missing attribute does not.
func (f *ldapFilter) matches(properties map[string]string) bool {
	if f == nil || properties == nil {
		return true
	}
	switch f.op {
	case '&':
		for _, child := range f.children {
			if !child.matches(properties) {
				return false
			}
		}
		return true
	case '|':
		for _, child := range f.children {
			if child.matches(properties) {
				return true
			}
		}
		return false
	case '!':
		return !f.children[0].matches(properties)
	}
	actual, ok := properties[f.attr]
	if !ok {
		return false
	}
	switch f.op {
	case '~':
		return strings.EqualFold(strings.TrimSpace(actual), strings.TrimSpace(f.value))
	case '>':
		return compareFilterValues(actual, f.value) >= 0
	case '<':
		return compareFilterValues(actual, f.value) <= 0
	}
	if f.value == "*" {
		return true
	}
	if strings.Contains(f.value, "*") {
		matched, err := path.Match(f.value, actual)
		return err == nil && matched
	}
	return actual == f.value
}

// compareFilterValues compares versions as versions, everything else as text.
func compareFilterValues(a, b string) int {
	va, errA := ParseVersion(a)
	vb, errB := ParseVersion(b)
	if errA == nil && errB == nil {
		return va.Compare(vb)
	}
	return strings.Compare(a, b)
}

type filterParser struct {
	text string
	pos  int
}

func (p *filterParser) skipSpaces() {
	for p.pos < len(p.text) && p.text[p.pos] == ' ' {
		p.pos++
	}
}

func (p *filterParser) expect(char byte) error {
	p.skipSpaces()
	if p.pos >= len(p.text) || p.text[p.pos] != char {
		return fmt.Errorf("invalid filter %q: expected %q at position %d", p.text, char, p.pos)
	}
	p.pos++
	return nil
}

func (p *filterParser) filter() (*ldapFilter, error) {
	if err := p.expect('('); err != nil {
		return nil, err
	}
	p.skipSpaces()
	if p.pos >= len(p.text) {
		return nil, fmt.Errorf("invalid filter %q: truncated", p.text)
	}
	var result *ldapFilter
	var err error
	switch op := p.text[p.pos]; op {
	case '&', '|', '!':
		p.pos++
		result, err = p.composite(op)
	default:
		result, err = p.comparison()
	}
	if err != nil {
		return nil, err
	}
	return result, p.expect(')')
}

func (p *filterParser) composite(op byte) (*ldapFilter, error) {
	result := &ldapFilter{op: op}
	for {
		p.skipSpaces()
		if p.pos >= len(p.text) || p.text[p.pos] != '(' {
			break
		}
		child, err := p.filter()
		if err != nil {
			return nil, err
		}
		result.children = append(result.children, child)
	}
	if len(result.children) == 0 || (op == '!' && len(result.children) != 1) {
		return nil, fmt.Errorf("invalid filter %q: bad %q operands", p.text, op)
	}
	return result, nil
}

func (p *filterParser) comparison() (*ldapFilter, error) {
	start := p.pos
	for p.pos < len(p.text) && !strings.ContainsRune("=~<>()", rune(p.text[p.pos])) {
		p.pos++
	}
	attr := strings.TrimSpace(p.text[start:p.pos])
	if attr == "" || p.pos >= len(p.text) {
		return nil, fmt.Errorf("invalid filter %q: missing attribute", p.text)
	}
	op := p.text[p.pos]
	if op != '=' {
		p.pos++
		if p.pos >= len(p.text) || p.text[p.pos] != '=' {
			return nil, fmt.Errorf("invalid filter %q: bad operator", p.text)
		}
	}
	p.pos++
	var value strings.Builder
	for p.pos < len(p.text) && p.text[p.pos] != ')' {
		if p.text[p.pos] == '\\' && p.pos+1 < len(p.text) {
			p.pos++
		}
		value.WriteByte(p.text[p.pos])
		p.pos++
	}
	return &ldapFilter{op: op, attr: attr, value: value.String()}, nil
}
