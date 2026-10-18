package maven

import (
	"archive/zip"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/securityintel"
)

// I test costruiscono class file reali in memoria: la distinzione fra conferma e
// ipotesi dipende dalle istruzioni del bytecode, e solo un .class vero la esercita.
// Il formato è quello della JVM specification chapter 4.

// classBuilder costruisce un file .class minimale ma valido: constant pool,
// this/super class, un metodo con attributo Code e, se serve, BootstrapMethods.
type classBuilder struct {
	entries []byte
	count   uint16
	lookup  map[string]uint16
	// bootstrapMethods sono le voci dell'attributo BootstrapMethods da serializzare.
	bootstrapMethods [][]byte
}

func newClassBuilder() *classBuilder {
	return &classBuilder{lookup: map[string]uint16{}}
}

func (b *classBuilder) add(key string, entry []byte) uint16 {
	b.count++
	b.entries = append(b.entries, entry...)
	b.lookup[key] = b.count
	return b.count
}

func appendU2(entry []byte, value uint16) []byte {
	return binary.BigEndian.AppendUint16(entry, value)
}

func (b *classBuilder) utf8(value string) uint16 {
	if index, ok := b.lookup["utf8:"+value]; ok {
		return index
	}
	entry := appendU2([]byte{tagUtf8}, uint16(len(value)))
	entry = append(entry, value...)
	return b.add("utf8:"+value, entry)
}

func (b *classBuilder) classRef(internalName string) uint16 {
	if index, ok := b.lookup["class:"+internalName]; ok {
		return index
	}
	entry := appendU2([]byte{tagClass}, b.utf8(internalName))
	return b.add("class:"+internalName, entry)
}

func (b *classBuilder) nameAndType(name, descriptor string) uint16 {
	key := "nat:" + name + descriptor
	if index, ok := b.lookup[key]; ok {
		return index
	}
	entry := appendU2([]byte{tagNameAndType}, b.utf8(name))
	entry = appendU2(entry, b.utf8(descriptor))
	return b.add(key, entry)
}

func (b *classBuilder) methodRef(class, name string) uint16 {
	key := "method:" + class + "." + name
	if index, ok := b.lookup[key]; ok {
		return index
	}
	entry := appendU2([]byte{tagMethodref}, b.classRef(class))
	entry = appendU2(entry, b.nameAndType(name, "()V"))
	return b.add(key, entry)
}

func (b *classBuilder) stringConstant(value string) uint16 {
	entry := appendU2([]byte{tagString}, b.utf8(value))
	return b.add("string:"+value, entry)
}

func (b *classBuilder) methodHandle(refIndex uint16) uint16 {
	entry := appendU2([]byte{tagMethodHandle, 6}, refIndex)
	return b.add("handle", entry)
}

func (b *classBuilder) invokeDynamic(bootstrapIndex uint16) uint16 {
	entry := appendU2([]byte{tagInvokeDynamic}, bootstrapIndex)
	entry = appendU2(entry, b.nameAndType("run", "()Ljava/lang/Runnable;"))
	return b.add("indy", entry)
}

// addBootstrapMethod registra una voce di BootstrapMethods: handle bootstrap e
// argomenti (dove finiscono i method reference delle lambda).
func (b *classBuilder) addBootstrapMethod(handle uint16, arguments ...uint16) uint16 {
	entry := appendU2(nil, handle)
	entry = appendU2(entry, uint16(len(arguments)))
	for _, argument := range arguments {
		entry = appendU2(entry, argument)
	}
	b.bootstrapMethods = append(b.bootstrapMethods, entry)
	return uint16(len(b.bootstrapMethods) - 1)
}

// build serializza il file .class con il metodo "main" il cui corpo è code.
func (b *classBuilder) build(className string, code []byte) []byte {
	thisClass := b.classRef(className)
	superClass := b.classRef("java/lang/Object")
	codeAttribute := b.utf8("Code")
	mainName := b.utf8("main")
	mainDescriptor := b.utf8("([Ljava/lang/String;)V")
	bootstrapName := b.utf8("BootstrapMethods")

	data := []byte{0xCA, 0xFE, 0xBA, 0xBE}
	data = appendU2(data, 0)  // minor_version
	data = appendU2(data, 52) // major_version: Java 8
	data = appendU2(data, b.count+1)
	data = append(data, b.entries...)
	data = appendU2(data, 0x0021) // ACC_PUBLIC | ACC_SUPER
	data = appendU2(data, thisClass)
	data = appendU2(data, superClass)
	data = appendU2(data, 0) // interfacce
	data = appendU2(data, 0) // campi

	// Un metodo con il Code: max_stack, max_locals, code, eccezioni, attributi.
	codePayload := appendU2(nil, 2)
	codePayload = appendU2(codePayload, 2)
	codePayload = binary.BigEndian.AppendUint32(codePayload, uint32(len(code)))
	codePayload = append(codePayload, code...)
	codePayload = appendU2(codePayload, 0) // exception_table_length
	codePayload = appendU2(codePayload, 0) // attributes_count del Code

	data = appendU2(data, 1) // un metodo
	data = appendU2(data, 0x0009)
	data = appendU2(data, mainName)
	data = appendU2(data, mainDescriptor)
	data = appendU2(data, 1) // un attributo: Code
	data = appendU2(data, codeAttribute)
	data = binary.BigEndian.AppendUint32(data, uint32(len(codePayload)))
	data = append(data, codePayload...)

	// Attributi della classe: BootstrapMethods se richiesto.
	if len(b.bootstrapMethods) > 0 {
		payload := appendU2(nil, uint16(len(b.bootstrapMethods)))
		for _, method := range b.bootstrapMethods {
			payload = append(payload, method...)
		}
		data = appendU2(data, 1)
		data = appendU2(data, bootstrapName)
		data = binary.BigEndian.AppendUint32(data, uint32(len(payload)))
		data = append(data, payload...)
	} else {
		data = appendU2(data, 0)
	}
	return data
}

func invokeStatic(member uint16) []byte  { return appendU2([]byte{0xb8}, member) }
func invokeVirtual(member uint16) []byte { return appendU2([]byte{0xb6}, member) }

// invokeDynamicCode è un'istruzione invokedynamic: opcode, indice nel constant pool
// e i due byte riservati (JVM §6.5.invokedynamic).
func invokeDynamicCode(index uint16) []byte {
	code := appendU2([]byte{0xba}, index)
	return appendU2(code, 0)
}
func checkCast(class uint16) []byte { return appendU2([]byte{0xc0}, class) }

var returnInstruction = []byte{0xb1}

// writeClass scrive un .class nel build output del progetto.
func writeClass(t *testing.T, root, internalName string, data []byte) {
	t.Helper()
	path := filepath.Join(root, "target", "classes", filepath.FromSlash(internalName)+".class")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeJar scrive un JAR con le classi indicate.
func writeJar(t *testing.T, path string, classes map[string][]byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	for name, data := range classes {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func findingWithDetails(summary, details string, component securityintel.Component) securityintel.Finding {
	return securityintel.Finding{
		Advisory:  securityintel.Advisory{ID: "GHSA-test", Summary: summary, Details: details},
		Component: component,
	}
}

var testComponent = securityintel.Component{
	Ecosystem: securityintel.EcosystemMaven,
	Name:      "org.apache.commons:commons-text",
	Version:   "1.9",
}

func analyze(t *testing.T, root string, finding securityintel.Finding) securityintel.Evidence {
	t.Helper()
	adapter := New()
	evidence, err := adapter.AnalyzeReachability(context.Background(),
		securityintel.Target{Ecosystem: securityintel.EcosystemMaven, Root: root, Manifest: filepath.Join(root, "pom.xml")},
		[]securityintel.Finding{finding}, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatalf("AnalyzeReachability: %v", err)
	}
	if len(evidence) != 1 {
		t.Fatalf("got %d evidence, want 1", len(evidence))
	}
	return evidence[0]
}

// Una reale istruzione di invocazione verso il simbolo vulnerabile è l'unica cosa
// che può produrre una conferma.
func TestBytecodeEvidenceConfirmsARealInvocation(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	code := append(invokeStatic(builder.methodRef("org/apache/commons/text/StringEscapeUtils", "unescapeJava")), returnInstruction...)
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"The org.apache.commons.text.StringEscapeUtils.unescapeJava method is affected",
		"", testComponent)
	evidence := analyze(t, root, finding)

	if !evidence.Confirmed {
		t.Fatal("an invokestatic to the vulnerable method must be a confirmed call")
	}
	if evidence.Method != securityintel.EvidenceMethodBytecodeReference {
		t.Errorf("Method = %q, want %q", evidence.Method, securityintel.EvidenceMethodBytecodeReference)
	}
	if evidence.Note != securityintel.ReachabilityNote(securityintel.ReachabilityCalled) {
		t.Errorf("Note = %q, want the called note", evidence.Note)
	}
	if len(evidence.Symbols) != 1 || evidence.Symbols[0] != "org.apache.commons.text.StringEscapeUtils.unescapeJava" {
		t.Errorf("Symbols = %v, want the vulnerable symbol", evidence.Symbols)
	}
}

// Un metodo reference dentro una lambda (invokedynamic + BootstrapMethods) è una
// reale istruzione di invocazione verso il simbolo.
func TestBytecodeEvidenceConfirmsAnInvokedynamicTarget(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	target := builder.methodRef("org/apache/commons/text/StringEscapeUtils", "unescapeJava")
	handle := builder.methodHandle(target)
	bootstrap := builder.addBootstrapMethod(handle, handle)
	site := builder.invokeDynamic(bootstrap)
	code := append(invokeDynamicCode(site), returnInstruction...)
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils.unescapeJava", "", testComponent)
	evidence := analyze(t, root, finding)

	if !evidence.Confirmed {
		t.Fatal("an invokedynamic resolving to the vulnerable method must be a confirmed call")
	}
}

// Un riferimento senza invocazione (checkcast, new, firma, costante stringa) è solo
// un'ipotesi: il finding resta potenzialmente raggiungibile.
func TestBytecodeEvidenceDoesNotConfirmAClassReference(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	vulnerable := builder.classRef("org/apache/commons/text/StringEscapeUtils")
	code := []byte{0x2a} // aload_0
	code = append(code, checkCast(vulnerable)...)
	code = append(code, 0x57, 0xb1) // pop, return
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"Uses of org.apache.commons.text.StringEscapeUtils are affected", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed {
		t.Fatal("a class reference without an invocation must never be confirmed")
	}
	if len(evidence.Symbols) == 0 {
		t.Fatal("the referenced symbol must be reported so the finding stays potentially reachable")
	}
	if evidence.Note != securityintel.ReachabilityNote(securityintel.ReachabilityPotentiallyReachable) {
		t.Errorf("Note = %q, want the potentially reachable note", evidence.Note)
	}
}

// La libreria è chiamata, ma non il metodo vulnerabile: non è una conferma.
func TestBytecodeEvidenceDoesNotConfirmAnotherMethod(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	code := append(invokeVirtual(builder.methodRef("org/apache/commons/text/StringEscapeUtils", "escapeHtml4")), returnInstruction...)
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils.unescapeJava", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed {
		t.Fatal("invoking another method of the vulnerable class must not confirm the vulnerable one")
	}
	if len(evidence.Symbols) == 0 {
		t.Fatal("the vulnerable class is used: the finding must stay potentially reachable")
	}
}

// Il nome del simbolo in una costante stringa è class loading dinamico: ipotesi.
func TestBytecodeEvidenceTreatsStringConstantsAsHypotheses(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	constant := builder.stringConstant("org.apache.commons.text.StringEscapeUtils")
	code := append([]byte{0x12, byte(constant)}, 0x57, 0xb1) // ldc, pop, return
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed {
		t.Fatal("a string constant must never be confirmed")
	}
	if len(evidence.Symbols) == 0 {
		t.Fatal("a dynamic class loading hint keeps the finding potentially reachable")
	}
}

// Niente di trovato: l'analisi è inconcludente e non promuove a notReachable.
func TestBytecodeEvidenceIsInconclusiveWhenNothingIsFound(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	code := append(invokeStatic(builder.methodRef("com/example/Other", "run")), returnInstruction...)
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils.unescapeJava", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed || len(evidence.Symbols) > 0 {
		t.Fatalf("nothing was found: Confirmed=%v Symbols=%v", evidence.Confirmed, evidence.Symbols)
	}
	if evidence.Method != securityintel.EvidenceMethodBytecodeReference {
		t.Errorf("Method = %q, want %q", evidence.Method, securityintel.EvidenceMethodBytecodeReference)
	}
	if !strings.HasPrefix(evidence.Note, securityintel.ReachabilityNote(securityintel.ReachabilityUnknown)) {
		t.Errorf("Note = %q, want it to start from the unknown note", evidence.Note)
	}
	if !strings.Contains(evidence.Note, "not proof that it is unreachable") {
		t.Errorf("Note = %q, want it to say the analysis cannot exclude reachability", evidence.Note)
	}
}

// Nessun bytecode da analizzare: l'evidenza lo dice invece di dichiarare il codice
// irraggiungibile.
func TestBytecodeEvidenceSaysWhenThereIsNothingToAnalyze(t *testing.T) {
	root := t.TempDir()
	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed || len(evidence.Symbols) > 0 {
		t.Fatal("with no compiled code there is nothing to confirm")
	}
	if !strings.Contains(evidence.Note, "No compiled classes or JARs") {
		t.Errorf("Note = %q, want it to say there was nothing to analyze", evidence.Note)
	}
}

// Le classi dentro i JAR del build output si leggono come le directory.
func TestBytecodeEvidenceScansTargetJARs(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	code := append(invokeStatic(builder.methodRef("org/apache/commons/text/StringEscapeUtils", "unescapeJava")), returnInstruction...)
	writeJar(t, filepath.Join(root, "target", "app.jar"), map[string][]byte{
		"com/example/App.class": builder.build("com/example/App", code),
	})

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils.unescapeJava", "", testComponent)
	evidence := analyze(t, root, finding)

	if !evidence.Confirmed {
		t.Fatal("a call found inside a target JAR must be confirmed exactly like one in target/classes")
	}
}

// Advisory senza simboli nominati: la chiamata non è confermabile, ma l'uso delle
// classi della libreria vulnerabile resta un'ipotesi onesta e utile.
func TestBytecodeEvidenceReportsLibraryUsageWithoutConfirming(t *testing.T) {
	root := t.TempDir()
	repository := t.TempDir()
	writeJar(t, filepath.Join(repository, "org", "example", "lib", "1.0", "lib-1.0.jar"), map[string][]byte{
		"org/example/lib/Parser.class": newClassBuilder().build("org/example/lib/Parser", returnInstruction),
	})

	builder := newClassBuilder()
	code := append(invokeVirtual(builder.methodRef("org/example/lib/Parser", "parse")), returnInstruction...)
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"Improper input validation in the parser component", "",
		securityintel.Component{Ecosystem: securityintel.EcosystemMaven, Name: "org.example:lib", Version: "1.0"})
	adapter := New()
	evidence, err := adapter.AnalyzeReachability(context.Background(),
		securityintel.Target{Ecosystem: securityintel.EcosystemMaven, Root: root, Manifest: filepath.Join(root, "pom.xml")},
		[]securityintel.Finding{finding},
		securityintel.ResolveOptions{Environment: []string{"maven.repo.local=" + repository}})
	if err != nil {
		t.Fatalf("AnalyzeReachability: %v", err)
	}
	if len(evidence) != 1 {
		t.Fatalf("got %d evidence, want 1", len(evidence))
	}
	if evidence[0].Confirmed {
		t.Fatal("without a named vulnerable symbol a library call must never be confirmed")
	}
	if len(evidence[0].Symbols) == 0 || evidence[0].Symbols[0] != "org/example/lib/Parser" {
		t.Errorf("Symbols = %v, want the used library class", evidence[0].Symbols)
	}
}

// Il bytecode si decodifica istruzione per istruzione: un byte 0xb8 dentro un
// operando non è una chiamata.
func TestBytecodeEvidenceDoesNotConfirmOperandBytes(t *testing.T) {
	root := t.TempDir()
	builder := newClassBuilder()
	// Metodo vulnerabile nel constant pool ma mai invocato: resta un riferimento.
	builder.methodRef("org/apache/commons/text/StringEscapeUtils", "unescapeJava")
	// sipush con operando 0xB801: i byte 0xb8 appaiono nel flusso ma non sono un
	// opcode, e soprattutto non c'è alcun invokestatic verso il simbolo vulnerabile.
	code := []byte{0x11, 0xb8, 0x01, 0xb1}
	writeClass(t, root, "com/example/App", builder.build("com/example/App", code))

	finding := findingWithDetails(
		"org.apache.commons.text.StringEscapeUtils.unescapeJava", "", testComponent)
	evidence := analyze(t, root, finding)

	if evidence.Confirmed {
		t.Fatal("operand bytes must never be decoded as an invocation")
	}
}
