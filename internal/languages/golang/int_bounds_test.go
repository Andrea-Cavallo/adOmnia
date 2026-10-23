package golang

import (
	"go/ast"
	"go/token"
	"testing"
)

// An integer literal wider than 32 bits is "not an int literal": it must not be wrapped into a wrong value.
func TestIntLiteralRejectsValuesThatDoNotFitThirtyTwoBits(t *testing.T) {
	cases := map[string]bool{"8080": true, "0x1F90": true, "2147483647": true, "2147483648": false, "9223372036854775807": false}
	for text, want := range cases {
		_, ok := intLiteral(&ast.BasicLit{Kind: token.INT, Value: text})
		if ok != want {
			t.Errorf("intLiteral(%s) ok = %v, want %v", text, ok, want)
		}
	}
	if value, ok := intLiteral(&ast.BasicLit{Kind: token.INT, Value: "8080"}); !ok || value != 8080 {
		t.Fatalf("value = %d ok = %v", value, ok)
	}
}
