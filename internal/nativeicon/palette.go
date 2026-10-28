package nativeicon

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strconv"
	"strings"
)

func paletteColor(hex string) (color.NRGBA, error) {
	if len(hex) != 7 || hex[0] != '#' {
		return color.NRGBA{}, fmt.Errorf("invalid icon accent")
	}
	value, err := strconv.ParseUint(hex[1:], 16, 24)
	if err != nil {
		return color.NRGBA{}, fmt.Errorf("invalid icon accent")
	}
	return color.NRGBA{uint8(value >> 16), uint8(value >> 8), uint8(value), 255}, nil
}

// Render the transparent monochrome artwork in the exact palette color.
func palettePNG(mode, accent string, size int) ([]byte, error) {
	if err := validateMode(mode); err != nil {
		return nil, err
	}
	ink, err := paletteColor(strings.ToUpper(accent))
	if err != nil {
		return nil, err
	}
	source, err := png.Decode(bytes.NewReader(pngForMode(mode)))
	if err != nil {
		return nil, err
	}
	output := image.NewNRGBA(image.Rect(0, 0, size, size))
	bounds := source.Bounds()
	// Area sampling retains antialiasing at native taskbar sizes.
	for y := range size {
		for x := range size {
			x0 := x * bounds.Dx() / size
			x1 := (x + 1) * bounds.Dx() / size
			y0 := y * bounds.Dy() / size
			y1 := (y + 1) * bounds.Dy() / size
			var alpha uint64
			var count uint64
			for sy := y0; sy < max(y0+1, y1); sy++ {
				for sx := x0; sx < max(x0+1, x1); sx++ {
					_, _, _, a := source.At(bounds.Min.X+sx, bounds.Min.Y+sy).RGBA()
					alpha += uint64(a)
					count++
				}
			}
			pixel := ink
			pixel.A = uint8(alpha / count / 257)
			output.SetNRGBA(x, y, pixel)
		}
	}
	var result bytes.Buffer
	err = png.Encode(&result, output)
	return result.Bytes(), err
}
