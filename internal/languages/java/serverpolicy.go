package java

import "github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"

// ServerBlocked implements language.ServerBlocker. Eclipse JDT LS runs on a modern JVM and has no
// PDE: it cannot read a target platform, its compiler refuses anything below Java 8, and it does
// not know the PDE natures. On a Tycho/PDE workspace it therefore reports "Compiling for Java
// version '1.6' is no longer supported" for every file (plus removed APIs such as Pack200 and
// "Unknown referenced nature: org.eclipse.pde.PluginNature") even though the project is fine: the
// OSGi engine compiles those bundles with the ECJ of the target on the project JVM.
func (*Language) ServerBlocked(projectRoot string) string {
	if eclipsepde.HasBundles(projectRoot) {
		return "OSGi/PDE workspace: the Java language server cannot read the target platform or Java 6, so its errors would be wrong. Live checking is off here: use Java > Build OSGi Bundles for the real compiler errors."
	}
	return ""
}
