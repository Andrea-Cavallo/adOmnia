package terminal

import "testing"

func TestCompleteUTF8Prefix(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want int
	}{
		{"vuoto", nil, 0},
		{"ascii", []byte("abc"), 3},
		{"rune completa", []byte("aè"), 3},
		{"due byte, manca uno", []byte{'a', 0xC3}, 1},
		{"tre byte, manca uno", []byte{'a', 0xE2, 0x82}, 1},
		{"quattro byte, mancano due", []byte{'a', 0xF0, 0x9F}, 1},
		{"quattro byte completi", []byte("a😀"), 5},
		{"continuazione orfana non trattenuta", []byte{'a', 0x80}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := completeUTF8Prefix(tc.data); got != tc.want {
				t.Fatalf("completeUTF8Prefix(%v) = %d, atteso %d", tc.data, got, tc.want)
			}
		})
	}
}
