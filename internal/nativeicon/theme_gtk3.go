//go:build linux && gtk3

package nativeicon

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>
#include <stdlib.h>
static void set_theme_icon(void *handle, const char *file) {
    gtk_window_set_icon_from_file(GTK_WINDOW(handle), file, NULL);
}
*/
import "C"

import (
	"path/filepath"
	"unsafe"
)

func setThemeIcon(window unsafe.Pointer, path, mode string) {
	file := C.CString(filepath.Join(path, "adomnia-theme-"+mode+".png"))
	defer C.free(unsafe.Pointer(file))
	C.set_theme_icon(window, file)
}
