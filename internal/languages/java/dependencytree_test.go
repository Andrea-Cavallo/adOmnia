package java

import (
	"strings"
	"testing"
)

const sampleTree = `com.acme:app:jar:1.0
+- org.springframework.boot:spring-boot-starter-web:jar:3.2.0:compile
|  +- org.springframework.boot:spring-boot-starter:jar:3.2.0:compile
|  |  \- (jakarta.annotation:jakarta.annotation-api:jar:2.1.1:compile - omitted for duplicate)
|  \- (com.fasterxml.jackson.core:jackson-databind:jar:2.15.0:compile - omitted for conflict with 2.16.1)
+- com.fasterxml.jackson.core:jackson-databind:jar:2.16.1:compile
|  \- (org.slf4j:slf4j-api:jar:2.0.9:compile - version managed from 1.7.36; omitted for duplicate)
\- io.netty:netty-transport-native-epoll:jar:linux-x86_64:4.1.100:runtime
`

func TestParseDependencyTree(t *testing.T) {
	nodes := ParseDependencyTree(strings.ReplaceAll(sampleTree, "\n", "\r\n"))
	if len(nodes) != 8 {
		t.Fatalf("got %d nodes: %+v", len(nodes), nodes)
	}
	if root := nodes[0]; root.Depth != 0 || root.ArtifactID != "app" || root.Version != "1.0" {
		t.Fatalf("root: %+v", root)
	}
	if web := nodes[1]; web.Depth != 1 || web.Scope != "compile" || web.Status != TreeResolved {
		t.Fatalf("direct dependency: %+v", web)
	}
	if starter := nodes[2]; starter.Depth != 2 {
		t.Fatalf("transitive depth: %+v", starter)
	}
	if duplicate := nodes[3]; duplicate.Depth != 3 || duplicate.Status != TreeOmittedDuplicate {
		t.Fatalf("omitted duplicate: %+v", duplicate)
	}
	if conflict := nodes[4]; conflict.Status != TreeOmittedConflict || conflict.ConflictWith != "2.16.1" || conflict.Version != "2.15.0" {
		t.Fatalf("omitted conflict: %+v", conflict)
	}
	if managed := nodes[6]; managed.ManagedFrom != "1.7.36" || managed.Status != TreeOmittedDuplicate {
		t.Fatalf("managed: %+v", managed)
	}
	if native := nodes[7]; native.Classifier != "linux-x86_64" || native.Version != "4.1.100" || native.Scope != "runtime" {
		t.Fatalf("classifier: %+v", native)
	}
}
