package windowfit

import "testing"

func TestFitShrinksSizeAndMinimumsToTheWorkArea(t *testing.T) {
	tests := []struct {
		name                               string
		width, height, minWidth, minHeight int
		maxW, maxH                         int
		wantW, wantH, wantMinW, wantMinH   int
	}{
		{
			name:  "large screen leaves the requested size alone",
			width: 1400, height: 900, minWidth: 900, minHeight: 600,
			maxW: 2560, maxH: 1440,
			wantW: 1400, wantH: 900, wantMinW: 900, wantMinH: 600,
		},
		{
			name:  "small screen shrinks the window to the work area",
			width: 1400, height: 900, minWidth: 900, minHeight: 600,
			maxW: 1280, maxH: 720,
			wantW: 1280, wantH: 720, wantMinW: 900, wantMinH: 600,
		},
		{
			name:  "a minimum larger than the screen is clamped too",
			width: 1400, height: 900, minWidth: 900, minHeight: 600,
			maxW: 800, maxH: 500,
			wantW: 800, wantH: 500, wantMinW: 800, wantMinH: 500,
		},
		{
			name:  "width and height are clamped independently",
			width: 1400, height: 700, minWidth: 900, minHeight: 600,
			maxW: 1280, maxH: 1024,
			wantW: 1280, wantH: 700, wantMinW: 900, wantMinH: 600,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			w, h, minW, minH := fit(test.width, test.height, test.minWidth, test.minHeight, test.maxW, test.maxH)
			if w != test.wantW || h != test.wantH || minW != test.wantMinW || minH != test.wantMinH {
				t.Fatalf("fit(%d,%d,%d,%d over %dx%d) = %d,%d,%d,%d, want %d,%d,%d,%d",
					test.width, test.height, test.minWidth, test.minHeight, test.maxW, test.maxH,
					w, h, minW, minH, test.wantW, test.wantH, test.wantMinW, test.wantMinH)
			}
		})
	}
}

func TestSizeWithoutScreenInformationKeepsTheRequest(t *testing.T) {
	w, h, minW, minH := Size(nil, 1400, 900, 900, 600)
	if w != 1400 || h != 900 || minW != 900 || minH != 600 {
		t.Fatalf("Size(nil, 1400, 900, 900, 600) = %d,%d,%d,%d, want the request unchanged", w, h, minW, minH)
	}
}
