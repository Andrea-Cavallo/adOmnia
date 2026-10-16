package lsp

import (
	"math/rand"
	"strings"
	"testing"
)

func TestIncrementalChangeRoundTrip(t *testing.T) {
	pairs := [][2]string{{"", "hello"}, {"hello", ""}, {"same", "same"}, {"a😀b", "a😁b"}, {"a\r\nb", "a\rb"}, {"a\rb", "a\r\nb"}, {"x\r\ny", "x\nZ\r\ny"}}
	random := rand.New(rand.NewSource(3))
	alphabet := []rune("ab\r\né中😀😁")
	for range 2000 {
		texts := [2]string{}
		for i := range texts {
			for n := random.Intn(40); n > 0; n-- {
				texts[i] += string(alphabet[random.Intn(len(alphabet))])
			}
		}
		pairs = append(pairs, texts)
	}
	for _, pair := range pairs {
		change := IncrementalChange(pair[0], pair[1])
		got, err := ApplyEdits(pair[0], []TextEdit{{Range: *change.Range, NewText: change.Text}})
		if err != nil || got != pair[1] {
			t.Fatalf("%q -> %q: %+v got %q: %v", pair[0], pair[1], change, got, err)
		}
	}
}

func TestIncrementalChangeUTF16AndSmallPayload(t *testing.T) {
	change := IncrementalChange("a😀b\r\nc", "a😀Xb\r\nc")
	if change.Range.Start != (Position{Line: 0, Character: 3}) || change.Text != "X" {
		t.Fatalf("%+v", change)
	}
	before := strings.Repeat("package name\n", 10000)
	change = IncrementalChange(before, before+"x")
	if change.Text != "x" {
		t.Fatalf("full buffer resent: %d bytes", len(change.Text))
	}
}
