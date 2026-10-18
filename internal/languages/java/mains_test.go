package java

import (
	"encoding/json"
	"testing"
)

func TestResolveMainClassAnswerIsParsedAndUnsafeNamesDropped(t *testing.T) {
	raw := json.RawMessage(`[{"mainClass":"it.acme.Zed","projectName":"app","filePath":"C:\\p\\src\\main\\java\\it\\acme\\Zed.java"},{"mainClass":"it.acme.App","projectName":"app","filePath":"/p/App.java"},{"mainClass":"bad name; rm","projectName":"x"}]`)
	found := ParseResolveMainClass(raw)
	if len(found) != 2 || found[0].Class != "it.acme.App" || found[0].Source != MainSourceJDT || found[1].File != "C:/p/src/main/java/it/acme/Zed.java" {
		t.Fatalf("found = %+v", found)
	}
	if ParseResolveMainClass(json.RawMessage(`not json`)) != nil {
		t.Fatal("a broken answer yields nothing")
	}
}

func TestScanFallbackIsMarkedAsScan(t *testing.T) {
	root := writeFixture(t, map[string]string{
		"pom.xml":                        "<project><artifactId>a</artifactId></project>",
		"src/main/java/it/acme/App.java": "package it.acme;\n@SpringBootApplication\npublic class App { public static void main(String[] args) {} }\n",
	})
	found := ScanMainClasses(root)
	if len(found) != 1 || found[0].Class != "it.acme.App" || !found[0].Spring || found[0].Source != MainSourceScan {
		t.Fatalf("found = %+v", found)
	}
}
