package lsp

import "testing"

func TestOffsetForPositionCountsUTF16Units(t *testing.T) {
	// "é" = 1 unità UTF-16 / 2 byte; "😀" = 2 unità UTF-16 (surrogate pair) / 4 byte.
	text := "package main\r\nvar s = \"é😀x\"\nvar t = 1"
	cases := []struct {
		position Position
		want     string
	}{
		{Position{Line: 0, Character: 8}, "main\r\n"},
		{Position{Line: 1, Character: 10}, "😀x\"\n"},
		{Position{Line: 1, Character: 12}, "x\"\n"},
		{Position{Line: 2, Character: 4}, "t = 1"},
		{Position{Line: 1, Character: 999}, "\nvar t = 1"},
	}
	for _, testCase := range cases {
		offset, err := OffsetForPosition(text, testCase.position)
		if err != nil {
			t.Fatal(err)
		}
		if got := text[offset:]; got[:min(len(got), len(testCase.want))] != testCase.want {
			t.Fatalf("posizione %+v: offset %d, testo %q", testCase.position, offset, got)
		}
	}
	if _, err := OffsetForPosition(text, Position{Line: 9}); err == nil {
		t.Fatal("riga oltre la fine accettata")
	}
}

func TestApplyEditsIsAtomicAndOrdered(t *testing.T) {
	text := "a😀b\nccc\n"
	edited, err := ApplyEdits(text, []TextEdit{
		{Range: Range{Start: Position{1, 0}, End: Position{1, 3}}, NewText: "d"},
		{Range: Range{Start: Position{0, 3}, End: Position{0, 4}}, NewText: "B"},
		{Range: Range{Start: Position{0, 0}, End: Position{0, 0}}, NewText: "// "},
	})
	if err != nil {
		t.Fatal(err)
	}
	if edited != "// a😀B\nd\n" {
		t.Fatalf("testo inatteso %q", edited)
	}
	if _, err := ApplyEdits(text, []TextEdit{
		{Range: Range{Start: Position{0, 0}, End: Position{0, 2}}, NewText: "x"},
		{Range: Range{Start: Position{0, 1}, End: Position{0, 3}}, NewText: "y"},
	}); err == nil {
		t.Fatal("modifiche sovrapposte accettate")
	}
}

func TestLineText(t *testing.T) {
	if got := LineText("one\r\ntwo\nthree", 1); got != "two" {
		t.Fatalf("riga inattesa %q", got)
	}
}
