package java

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// ServerBlocked implements language.ServerBlocker. Eclipse JDT LS has no PDE: it cannot read a target
// platform and does not know the PDE natures. On a PDE workspace it is therefore given a shadow
// workspace (eclipsepde.WriteShadowWorkspace) built from the active target, never the real metadata;
// without a target there is no classpath to give it, and it stays stopped with the reason.
func (*Language) ServerBlocked(projectRoot string) string {
	if eclipsepde.HasBundles(projectRoot) {
		if eclipsepde.HasActiveTarget(projectRoot) {
			return ""
		}
		return "PDE workspace without a target platform: live Java checking needs one to know what the bundles import. Choose it in Java → OSGi Bundles & Target Platform."
	}
	// The same limit applies outside OSGi: JDT LS supports 1.8 and newer only. A project that
	// declares 1.6/1.7 (Maven compiler.source/target/release or Gradle sourceCompatibility) is
	// built with the JDK selected for the project, never with the compiler of the language server.
	if required := RequiredJava(projectRoot); required > 0 && required < 8 {
		return fmt.Sprintf("This project compiles for Java %d, and Eclipse JDT LS supports 1.8 and newer only: its errors would be wrong. Select a JDK %d (Java → Select JDK) and build with Maven/Gradle; adOmnia compiles the project with that JDK.", required, required)
	}
	return ""
}
