package nativeicon

import (
	"bytes"
	"image/png"
	"testing"
)

func TestPaletteArtworkKeepsTransparencyAndExactInk(t *testing.T) {
	for _, mode := range []string{"dark", "light"} {
		data, err := palettePNG(mode, "#F3C600", 32)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		visible, clear := 0, 0
		for y := range 32 {
			for x := range 32 {
				pixel := img.At(x, y)
				r, g, b, a := pixel.RGBA()
				if a == 0 {
					clear++
					continue
				}
				visible++
				// Compare premultiplied values with a rounding allowance.
				if int(r)-int(243*a/255) > 257 || int(g)-int(198*a/255) > 257 || b != 0 {
					t.Fatal("wrong palette color")
				}
			}
		}
		if clear == 0 || visible == 0 {
			t.Fatal("glyph transparency lost")
		}
	}
	if _, err := palettePNG("dark", "bad", 16); err == nil {
		t.Fatal("invalid palette accepted")
	}
}
