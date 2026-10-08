//go:build windows

package nativeicon

import (
	"encoding/binary"
	"fmt"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

var user32 = windows.NewLazySystemDLL("user32.dll")
var sendMessage = user32.NewProc("SendMessageW")
var createIcon = user32.NewProc("CreateIconFromResourceEx")

type iconPair struct{ small, large uintptr }

var iconHandles = map[string]iconPair{}
var iconMutex sync.Mutex

// Four process-lifetime handles are reused across switches. Never destroy an
// icon still referenced by another application window.
func iconsForMode(mode string) (iconPair, error) {
	iconMutex.Lock()
	defer iconMutex.Unlock()
	if pair, ok := iconHandles[mode]; ok {
		return pair, nil
	}
	data, err := artwork.ReadFile("artwork/" + mode + ".ico")
	if err != nil {
		return iconPair{}, err
	}
	load := func(size int) (uintptr, error) {
		count := int(binary.LittleEndian.Uint16(data[4:6]))
		for i := 0; i < count; i++ {
			entry := data[6+i*16 : 6+(i+1)*16]
			if int(entry[0]) != size {
				continue
			}
			length := binary.LittleEndian.Uint32(entry[8:12])
			offset := binary.LittleEndian.Uint32(entry[12:16])
			frame := data[offset : offset+length]
			h, _, err := createIcon.Call(uintptr(unsafe.Pointer(&frame[0])), uintptr(length), 1, 0x30000, uintptr(size), uintptr(size), 0)
			if h == 0 {
				return 0, fmt.Errorf("create native icon: %w", err)
			}
			return h, nil
		}
		return 0, fmt.Errorf("icon missing %dpx frame", size)
	}
	small, err := load(16)
	if err != nil {
		return iconPair{}, err
	}
	large, err := load(32)
	if err != nil {
		user32.NewProc("DestroyIcon").Call(small)
		return iconPair{}, err
	}
	pair := iconPair{small, large}
	iconHandles[mode] = pair
	return pair, nil
}

func setWindowMode(hwnd uintptr, mode string) error {
	if err := validateMode(mode); err != nil {
		return err
	}
	pair, err := iconsForMode(mode)
	if err != nil {
		return err
	}
	sendMessage.Call(hwnd, 0x80, 0, pair.small) // WM_SETICON / ICON_SMALL
	sendMessage.Call(hwnd, 0x80, 1, pair.large) // WM_SETICON / ICON_BIG
	return nil
}

func Apply(app *application.App, mode string) error {
	if err := validateMode(mode); err != nil {
		return err
	}
	return application.InvokeSyncWithError(func() error {
		for _, window := range app.Window.GetAll() {
			if handle := window.NativeWindow(); handle != nil {
				if err := setWindowMode(uintptr(handle), mode); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
