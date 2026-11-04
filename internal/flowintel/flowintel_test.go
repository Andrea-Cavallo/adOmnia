package flowintel

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

func writeFlowFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// flowWorkspace is a legacy-style workspace with a declared flow, a subflow, a Java flow
// annotation, a SOAP class, an XML flow definition and one OSGi bundle.
func flowWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFlowFile(t, root, "plugins/com.acme.payments/src/com/acme/payments/PaymentFlow.java", `package com.acme.payments;

public class PaymentFlow {
	@Flow
	public void execute() {
		authorize();
		ledger.record();
	}

	@Subflow
	public void authorize() {
		new Helper().verify();
	}

	public void notify() {
	}
}
`)
	writeFlowFile(t, root, "plugins/com.acme.payments/src/com/acme/payments/Ledger.java", `package com.acme.payments;

public class Ledger {
	public void record() {
	}
}
`)
	writeFlowFile(t, root, "plugins/com.acme.payments/src/com/acme/payments/SoapGateway.java", `package com.acme.payments;

import javax.jws.WebService;

@WebService
public class SoapGateway {
	public String send(String body) {
		return body;
	}
}
`)
	writeFlowFile(t, root, "plugins/com.acme.payments/.project", `<projectDescription><name>com.acme.payments</name><natures><nature>org.eclipse.pde.PluginNature</nature></natures></projectDescription>`)
	writeFlowFile(t, root, "plugins/com.acme.payments/META-INF/MANIFEST.MF", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.payments
Bundle-Version: 1.0.0
Bundle-Activator: com.acme.payments.PaymentFlow
Service-Component: OSGI-INF/payments.xml
`)
	writeFlowFile(t, root, "plugins/com.acme.payments/OSGI-INF/payments.xml", `<?xml version="1.0"?>
<scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.1.0" name="payments">
  <implementation class="com.acme.payments.PaymentFlow"/>
  <service><provide interface="com.acme.payments.PaymentService"/></service>
</scr:component>
`)
	writeFlowFile(t, root, "flows/payment.xml", `<?xml version="1.0"?>
<flows>
  <flow id="AutorizzazionePagamento" name="Autorizzazione Pagamento">
    <subflow ref="VerificaRischio"/>
    <call flow="RegistraPagamento"/>
  </flow>
</flows>
`)
	writeFlowFile(t, root, ConfigFile, `{"version":1,"flows":[{"id":"ChiusuraGiornata","kind":"flow","method":"com.acme.payments.Ledger#record","calls":[{"method":"com.acme.payments.PaymentFlow#notify"}],"external":[{"kind":"soap","name":"Ufficio Anagrafe","detail":"gestione chiusura"}]}]}`)
	return root
}

func TestDiscoverFlowsJavaXMLDeclaredAndOSGi(t *testing.T) {
	root := flowWorkspace(t)
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	if discovery.Fingerprint == "" {
		t.Fatal("no fingerprint")
	}
	for _, kind := range []string{graph.KindFlow, graph.KindSubflow, graph.KindMethod, graph.KindBundle, graph.KindActivator, graph.KindService, graph.KindExternal} {
		if discovery.Counts[kind] == 0 {
			t.Fatalf("no %s node: counts=%v problems=%v", kind, discovery.Counts, discovery.Problems)
		}
	}
	adapters := strings.Join(discovery.Adapters, ",")
	for _, adapter := range []string{"declared", "xml", "osgi"} {
		if !strings.Contains(adapters, adapter) {
			t.Fatalf("adapter %s missing: %v", adapter, discovery.Adapters)
		}
	}
	index := NewIndex(discovery)
	flows := index.Flows()
	if len(flows) < 4 {
		t.Fatalf("flows = %+v", flows)
	}
	// The Java annotation produced a flow and a subflow around methods.
	if len(index.Search("PaymentFlow.execute", 5)) == 0 {
		t.Fatalf("no method node for execute: %+v", index.Search("execute", 5))
	}
	if len(index.Search("AutorizzazionePagamento", 5)) == 0 {
		t.Fatalf("no XML flow node")
	}
}

func TestTraceConfidenceAndCalls(t *testing.T) {
	root := flowWorkspace(t)
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	index := NewIndex(discovery)
	trace, err := index.Trace("PaymentFlow.execute", "downstream", 3)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Root.Kind != graph.KindFlow {
		t.Fatalf("root = %+v", trace.Root)
	}
	foundExecute, foundRecord, foundSoap := false, false, false
	for _, step := range trace.Steps {
		switch {
		case strings.HasSuffix(step.Node.ID, "PaymentFlow.execute"):
			foundExecute = true
		case strings.HasSuffix(step.Node.ID, "Ledger.record"):
			foundRecord = true
			if step.Edge.Confidence != graph.ConfidenceInferred {
				t.Fatalf("record confidence = %q", step.Edge.Confidence)
			}
		case step.Node.Kind == graph.KindExternal && step.Node.Attrs["type"] == "soap":
			foundSoap = true
		}
	}
	if !foundExecute || !foundRecord {
		t.Fatalf("trace steps = %+v", trace.Steps)
	}
	_ = foundSoap // the SOAP class has no call from execute; the declared flow adds one
}

func TestImpactUpstreamAndExplain(t *testing.T) {
	root := flowWorkspace(t)
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	index := NewIndex(discovery)
	impact, err := index.Impact("Ledger.record", 5)
	if err != nil {
		t.Fatal(err)
	}
	foundFlow := false
	for _, flow := range impact.Flows {
		if strings.Contains(flow.ID, "PaymentFlow.execute") || strings.Contains(flow.ID, "ChiusuraGiornata") {
			foundFlow = true
		}
	}
	if !foundFlow {
		t.Fatalf("impact flows = %+v, direct = %+v", impact.Flows, impact.Direct)
	}
	explanation, err := index.Explain("Ledger.record")
	if err != nil {
		t.Fatal(err)
	}
	if explanation.Node.File == "" || explanation.Source == nil || len(explanation.Source.Lines) == 0 {
		t.Fatalf("explanation = %+v", explanation)
	}
	if len(explanation.Incoming) == 0 {
		t.Fatalf("no incoming edges: %+v", explanation)
	}
}

func TestFindPathsBetweenFlowAndMethod(t *testing.T) {
	root := flowWorkspace(t)
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	index := NewIndex(discovery)
	paths, err := index.FindPaths("PaymentFlow.execute", "Ledger.record", 6, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 || len(paths[0].Nodes) < 2 {
		t.Fatalf("paths = %+v", paths)
	}
	if _, err := index.FindPaths("NoSuchFlow", "Ledger.record", 4, 2); err == nil {
		t.Fatal("an unknown start must fail")
	}
}

func TestDeclaredSubflowRefsCreateNodes(t *testing.T) {
	root := flowWorkspace(t)
	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	index := NewIndex(discovery)
	node, err := index.Resolve("VerificaRischio")
	if err != nil {
		t.Fatalf("subflow: %v", err)
	}
	if node.Kind != graph.KindSubflow {
		t.Fatalf("subflow node = %+v", node)
	}
	trace, err := index.Trace("AutorizzazionePagamento", "downstream", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) == 0 {
		t.Fatalf("no declared path: %+v", trace)
	}
}
