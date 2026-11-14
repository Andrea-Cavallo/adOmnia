package java

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// ServerBlocked implements language.ServerBlocker. Eclipse JDT LS has no PDE: it cannot read a target
// platform and does not know the PDE natures. On a PDE workspace it is therefore given a shadow
// workspace (eclipsepde.WriteShadowWorkspace) built from the active target, never the real metadata;
// without a target there is no classpath to give it, and it stays stopped with the reason.
//
// A Maven/Gradle project at Java 1.6/1.7 keeps the server: m2e lowers a level JDT no longer compiles
// to 1.8 (Java 6/7 sources are valid 1.8), like the PDE and WTP shadows do, while the real build
// stays on the project JDK at the project's own level.
func (*Language) ServerBlocked(projectRoot string) string {
	if eclipsepde.HasBundles(projectRoot) && !eclipsepde.HasActiveTarget(projectRoot) {
		return "PDE workspace without a target platform: live Java checking needs one to know what the bundles import. Choose it in Java → OSGi Bundles & Target Platform."
	}
	return ""
}
