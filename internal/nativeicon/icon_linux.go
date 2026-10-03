//go:build linux && !gtk3

// Package nativeicon provides the embedded application icon to GTK4's icon theme.
package nativeicon

/*
#cgo pkg-config: gtk4
#include <gtk/gtk.h>

static gboolean register_adomnia_icon(const void *data, gsize size) {
    GBytes *bytes = g_bytes_new(data, size);
    GResource *resource = g_resource_new_from_data(bytes, NULL);
    g_bytes_unref(bytes);
    if (resource == NULL) return FALSE;
    g_resources_register(resource);
    g_resource_unref(resource);
    return TRUE;
}

static void set_adomnia_icon(void *handle) {
    GtkWindow *window = GTK_WINDOW(handle);
    GdkDisplay *display = gtk_widget_get_display(GTK_WIDGET(window));
    GtkIconTheme *theme = gtk_icon_theme_get_for_display(display);
    gtk_icon_theme_add_resource_path(theme, "/com/adomnia/icons");
    gtk_window_set_icon_name(window, "adomnia");
}
*/
import "C"

import (
	_ "embed"
	"sync"
	"unsafe"
)

// Regenerate after changing the icon:
// glib-compile-resources internal/nativeicon/icons.gresource.xml --sourcedir=assets/icons/linux --target=internal/nativeicon/icons.gresource
//
//go:embed icons.gresource
var icons []byte

var registerOnce sync.Once
var registered bool

// Set must be called on the GTK main thread with a live GtkWindow.
func Set(window unsafe.Pointer) bool {
	if window == nil {
		return false
	}
	registerOnce.Do(func() {
		registered = C.register_adomnia_icon(unsafe.Pointer(&icons[0]), C.gsize(len(icons))) != 0
	})
	if !registered {
		return false
	}
	C.set_adomnia_icon(window)
	return true
}
