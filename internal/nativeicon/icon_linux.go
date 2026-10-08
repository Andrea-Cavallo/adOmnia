//go:build linux && !gtk3

// Package nativeicon provides the embedded application icon to GTK4's icon theme.
package nativeicon

/*
#cgo pkg-config: gtk4
#include <gtk/gtk.h>
#include <stdlib.h>

static void set_theme_icon(void *handle, const char *path, const char *name) {
    GtkWindow *window = GTK_WINDOW(handle);
    GtkIconTheme *theme = gtk_icon_theme_get_for_display(gtk_widget_get_display(GTK_WIDGET(window)));
    char **paths = gtk_icon_theme_get_search_path(theme);
    gboolean found = FALSE;
    for (int i = 0; paths != NULL && paths[i] != NULL; i++) {
        if (g_strcmp0(paths[i], path) == 0) { found = TRUE; break; }
    }
    g_strfreev(paths);
    if (!found) gtk_icon_theme_add_search_path(theme, path);
    gtk_window_set_icon_name(window, name);
}

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

func setThemeIcon(window unsafe.Pointer, path, mode string) {
	cPath := C.CString(path)
	cName := C.CString("adomnia-theme-" + mode)
	defer C.free(unsafe.Pointer(cPath))
	defer C.free(unsafe.Pointer(cName))
	C.set_theme_icon(window, cPath, cName)
}

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
