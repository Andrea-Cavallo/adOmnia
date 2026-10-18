package maven

import (
	"archive/zip"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/securityintel"
)

// Raggiungibilità Maven via bytecode: l'adapter cerca riferimenti a classi e metodi
// vulnerabili nelle classi compilate del progetto (target/classes/**/*.class e i
// *.jar in target/). Un JAR è uno ZIP, il formato .class è documentato nella JVM
// specification chapter 4 e le istruzioni nella chapter 6: non servono dipendenze
// esterne.
//
// Il punto di prodotto è la distinzione onesta, obbligatoria per Java:
//
//   - CONFERMATA: una reale istruzione di invocazione (invokevirtual,
//     invokeinterface, invokestatic, invokespecial, invokedynamic) nel codice punta
//     al simbolo vulnerabile. Solo allora Evidence.Confirmed = true e il finding
//     diventa "called".
//   - POTENZIALMENTE RAGGIUNGIBILE: il simbolo vulnerabile (o una classe della
//     libreria vulnerabile) è referenziato ma la chiamata non è provabile —
//     riflessione, class loading dinamico, framework, OSGi. Evidence.Confirmed
//     resta false, il simbolo finisce in Symbols e il finding resta
//     "potentiallyReachable".
//   - INCONCLUDENTE: niente di trovato, ma l'assenza di riferimenti nel bytecode
//     non dimostra che il codice vulnerabile sia irraggiungibile. L'evidenza lo dice
//     e il finding non viene promosso a "notReachable".
//
// Regola che questo file non viola mai: un'ipotesi non diventa conferma. Una
// conferma richiede un'istruzione di invocazione risolta contro il simbolo che
// l'advisory nomina; senza quel nome (molti advisory Java non citano classi) non si
// conferma nemmeno una chiamata alla libreria, perché "chiama la libreria" non è
// "chiama il codice vulnerabile".

// compile-time: l'adapter Maven implementa la capability di raggiungibilità, che il
// core scopre per type assertion (internal/securityintel/engine.go).
var _ securityintel.ReachabilityAnalyzer = (*Adapter)(nil)

// maxScannedClasses e maxScannedJars limitano la scansione contro build output
// patologici. Oltre il limite l'analisi resta inconcludente, non diventa "pulita".
const (
	maxScannedClasses = 50_000
	maxScannedJars    = 200
	maxClassBytes     = 8 << 20
	maxLibraryClasses = 20_000
	maxUsedClasses    = 20
)

// AnalyzeReachability implementa securityintel.ReachabilityAnalyzer.
//
// Restituisce un Evidence per ogni finding, nello stesso ordine. Un file illeggibile
// non invalida l'analisi degli altri: si salta e si continua.
func (a *Adapter) AnalyzeReachability(ctx context.Context, target securityintel.Target, findings []securityintel.Finding, options securityintel.ResolveOptions) ([]securityintel.Evidence, error) {
	evidence := make([]securityintel.Evidence, len(findings))
	index := scanProjectBytecode(ctx, target.Root)
	if index.scannedClasses == 0 {
		for position := range findings {
			evidence[position] = inconclusiveBytecodeEvidence(
				"No compiled classes or JARs were found in the project build output to analyze.")
		}
		return evidence, nil
	}
	repository := LocalRepository(options.Environment)
	for position, finding := range findings {
		evidence[position] = bytecodeEvidence(finding, index, repository)
	}
	return evidence, nil
}

// bytecodeEvidence traduce ciò che il bytecode dice di un singolo finding.
func bytecodeEvidence(finding securityintel.Finding, index bytecodeIndex, repository string) securityintel.Evidence {
	symbols := vulnerableSymbolsOf(finding.Advisory)
	if len(symbols) > 0 {
		return symbolEvidence(symbols, index)
	}
	// L'advisory non nomina alcuna classe: il simbolo vulnerabile è ignoto e una
	// chiamata non può essere confermata. Si guarda almeno se il progetto usa le
	// classi della libreria vulnerabile: è un'ipotesi, e resta tale.
	return libraryEvidence(finding.Component, index, repository)
}

// symbolEvidence valuta i simboli nominati dall'advisory: prima le invocazioni
// provate, poi i semplici riferimenti, poi l'inconcludente.
func symbolEvidence(symbols []vulnerableSymbol, index bytecodeIndex) securityintel.Evidence {
	confirmed := []string{}
	for _, symbol := range symbols {
		if index.invokes(symbol) {
			confirmed = appendDistinctString(confirmed, symbol.display)
		}
	}
	if len(confirmed) > 0 {
		return securityintel.Evidence{
			Method:    securityintel.EvidenceMethodBytecodeReference,
			Confirmed: true,
			Note:      securityintel.ReachabilityNote(securityintel.ReachabilityCalled),
			Symbols:   confirmed,
		}
	}
	referenced := []string{}
	for _, symbol := range symbols {
		if index.references(symbol) {
			referenced = appendDistinctString(referenced, symbol.display)
		}
	}
	if len(referenced) > 0 {
		return securityintel.Evidence{
			Method:    securityintel.EvidenceMethodBytecodeReference,
			Confirmed: false,
			Note:      securityintel.ReachabilityNote(securityintel.ReachabilityPotentiallyReachable),
			Symbols:   referenced,
		}
	}
	return inconclusiveBytecodeEvidence(
		"The bytecode analysis found no reference to the vulnerable code, but reflection, dynamic class loading, frameworks and OSGi can reach it anyway: this is not proof that it is unreachable.")
}

// libraryEvidence copre gli advisory senza simboli nominati: se il progetto
// referenzia classi della libreria vulnerabile il finding è potenzialmente
// raggiungibile, con una conferma che resta impossibile.
func libraryEvidence(component securityintel.Component, index bytecodeIndex, repository string) securityintel.Evidence {
	used := index.classesUsedFrom(libraryClasses(component, repository))
	if len(used) == 0 {
		return inconclusiveBytecodeEvidence(
			"The bytecode analysis found no reference to the vulnerable library, but reflection, dynamic class loading, frameworks and OSGi can reach it anyway: this is not proof that it is unreachable.")
	}
	return securityintel.Evidence{
		Method:    securityintel.EvidenceMethodBytecodeReference,
		Confirmed: false,
		Note:      securityintel.ReachabilityNote(securityintel.ReachabilityPotentiallyReachable),
		Symbols:   used,
	}
}

// inconclusiveBytecodeEvidence è il caso onesto: l'analisi c'è stata e non prova
// nulla. Non si promuove a "notReachable" e non si inventa un simbolo.
func inconclusiveBytecodeEvidence(detail string) securityintel.Evidence {
	return securityintel.Evidence{
		Method: securityintel.EvidenceMethodBytecodeReference,
		Note:   securityintel.ReachabilityNote(securityintel.ReachabilityUnknown) + " " + detail,
	}
}

// vulnerableSymbol è un simbolo Java nominato da un advisory: la classe che contiene
// il codice vulnerabile e, quando l'advisory lo dice, il metodo.
type vulnerableSymbol struct {
	class   string // nome interno: "org/apache/commons/text/StringEscapeUtils"
	method  string // vuoto quando l'advisory nomina solo la classe
	display string // forma pubblicata dall'advisory, per Evidence.Symbols
}

// matchesMember dice se un membro "classe.metodo" citato o invocato è il simbolo.
// Senza metodo nell'advisory qualunque membro della classe va bene: la classe è il
// simbolo vulnerabile.
func (s vulnerableSymbol) matchesMember(member string) bool {
	if s.method == "" {
		return strings.HasPrefix(member, s.class+".")
	}
	return member == s.class+"."+s.method
}

// javaSymbolPattern trova i riferimenti a classi Java nel testo dell'advisory:
// package in minuscolo, classe in maiuscolo, metodo opzionale dopo "." o "#".
var javaSymbolPattern = regexp.MustCompile(`\b([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+)\.([A-Z][A-Za-z0-9_$]*)(?:[#.]([a-z_][A-Za-z0-9_$]*))?`)

// vulnerableSymbolsOf estrae i simboli vulnerabili nominati dall'advisory. Gli
// advisory Java li citano nel testo ("the JndiManager.lookup method", le descrizioni
// GHSA/NVD): non esiste un campo strutturato affidabile, e meglio un simbolo in meno
// che un simbolo sbagliato da far passare per conferma.
func vulnerableSymbolsOf(advisory securityintel.Advisory) []vulnerableSymbol {
	text := advisory.Summary + "\n" + advisory.Details
	symbols := []vulnerableSymbol{}
	for _, match := range javaSymbolPattern.FindAllStringSubmatch(text, -1) {
		dotted := match[1] + "." + match[2]
		symbol := vulnerableSymbol{
			class:   strings.ReplaceAll(dotted, ".", "/"),
			display: dotted,
		}
		if match[3] != "" {
			symbol.method = match[3]
			symbol.display = dotted + "." + match[3]
		}
		duplicate := false
		for _, existing := range symbols {
			if existing.class == symbol.class && existing.method == symbol.method {
				duplicate = true
				break
			}
		}
		if !duplicate {
			symbols = append(symbols, symbol)
		}
	}
	return symbols
}

// libraryClassSet sono le classi di una libreria vulnerabile: nomi esatti quando il
// suo JAR è leggibile nella repository locale, altrimenti il prefisso di package del
// groupId. Servono a riconoscere l'uso della libreria quando l'advisory non nomina
// il simbolo vulnerabile.
type libraryClassSet struct {
	classes  map[string]bool
	prefixes []string
}

// matches dice se una classe appartiene alla libreria.
func (s libraryClassSet) matches(name string) bool {
	if s.classes[name] {
		return true
	}
	for _, prefix := range s.prefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// libraryClasses elenca le classi del componente vulnerabile. La fonte esatta è il
// suo JAR nella repository locale Maven (sola lettura, nessuna rete): il prefisso di
// package del groupId è il fallback quando il JAR non è disponibile.
func libraryClasses(component securityintel.Component, repository string) libraryClassSet {
	set := libraryClassSet{classes: map[string]bool{}}
	if jarPath := dependencyJarPath(repository, component); jarPath != "" {
		if names, err := jarClassNames(jarPath, maxLibraryClasses); err == nil {
			for _, name := range names {
				set.classes[name] = true
			}
		}
	}
	if len(set.classes) == 0 {
		group, _, _ := strings.Cut(component.Name, ":")
		if group != "" && strings.Count(group, ".") >= 1 {
			set.prefixes = append(set.prefixes, strings.ReplaceAll(group, ".", "/")+"/")
		}
	}
	return set
}

// dependencyJarPath è il percorso del JAR di una dipendenza nella repository locale,
// accanto al suo pom.
func dependencyJarPath(repository string, component securityintel.Component) string {
	group, artifact, found := strings.Cut(component.Name, ":")
	if !found || component.Version == "" {
		return ""
	}
	pomPath := PomPath(repository, Coordinate{GroupID: group, ArtifactID: artifact, Version: component.Version})
	if pomPath == "" {
		return ""
	}
	return strings.TrimSuffix(pomPath, ".pom") + ".jar"
}

// jarClassNames elenca i nomi delle classi contenute in un JAR.
func jarClassNames(path string, limit int) ([]string, error) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	names := []string{}
	for _, entry := range reader.File {
		if !strings.HasSuffix(entry.Name, ".class") || strings.HasPrefix(entry.Name, "META-INF/") {
			continue
		}
		if name := classNameFromPath(entry.Name); name != "" {
			names = append(names, name)
		}
		if len(names) >= limit {
			break
		}
	}
	return names, nil
}

// classNameFromPath traduce il percorso di una entry di JAR nel nome interno di
// classe ("org/foo/Bar.class" → "org/foo/Bar").
func classNameFromPath(path string) string {
	name := strings.TrimSuffix(filepath.ToSlash(path), ".class")
	if name == "" || strings.ContainsRune(name, ' ') {
		return ""
	}
	return name
}

// bytecodeIndex è ciò che il bytecode del progetto dice: quali simboli sono
// realmente invocati da un'istruzione, quali solo referenziati, quali nomi compaiono
// nelle costanti stringa (class loading per riflessione).
type bytecodeIndex struct {
	invoked         map[string]bool // membri "org/foo/Bar.method" invocati da un invoke*
	referenced      map[string]bool // classi "org/foo/Bar" e membri semplicemente citati
	stringConstants []string        // costanti stringa, per Class.forName e simili
	scannedClasses  int
	scannedJars     int
}

// scanProjectBytecode legge target/classes/**/*.class e i *.jar di target/.
func scanProjectBytecode(ctx context.Context, root string) bytecodeIndex {
	index := bytecodeIndex{
		invoked:    map[string]bool{},
		referenced: map[string]bool{},
	}
	classesDirectory := filepath.Join(root, "target", "classes")
	_ = filepath.WalkDir(classesDirectory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".class") {
			return nil
		}
		if index.scannedClasses >= maxScannedClasses {
			return filepath.SkipAll
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		index.addClass(data)
		return nil
	})

	jars, _ := filepath.Glob(filepath.Join(root, "target", "*.jar"))
	sort.Strings(jars)
	for _, jarPath := range jars {
		if ctx.Err() != nil || index.scannedJars >= maxScannedJars {
			break
		}
		index.addJar(jarPath)
	}
	return index
}

// addJar legge le classi compilate dentro un JAR del build output.
func (i *bytecodeIndex) addJar(path string) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return
	}
	defer reader.Close()
	i.scannedJars++
	for _, entry := range reader.File {
		if !strings.HasSuffix(entry.Name, ".class") || strings.HasPrefix(entry.Name, "META-INF/") {
			continue
		}
		if i.scannedClasses >= maxScannedClasses {
			return
		}
		if entry.UncompressedSize64 > maxClassBytes {
			continue
		}
		stream, err := entry.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(stream, maxClassBytes))
		stream.Close()
		if err != nil {
			continue
		}
		i.addClass(data)
	}
}

// addClass somma ai risultati ciò che un file .class dice.
func (i *bytecodeIndex) addClass(data []byte) {
	parsed, err := parseClassFile(data)
	if err != nil {
		return
	}
	i.scannedClasses++
	for member := range parsed.invoked {
		i.invoked[member] = true
	}
	for reference := range parsed.references {
		i.referenced[reference] = true
	}
	i.stringConstants = append(i.stringConstants, parsed.strings...)
}

// invokes dice se un'istruzione di invocazione del progetto punta al simbolo. È
// l'unica condizione che può produrre una conferma.
func (i bytecodeIndex) invokes(symbol vulnerableSymbol) bool {
	for member := range i.invoked {
		if symbol.matchesMember(member) {
			return true
		}
	}
	return false
}

// references dice se il simbolo è citato in qualche modo: classe usata (new,
// checkcast, instanceof, tipo di campo, superclasse, firma), membro referenziato o
// nome comparso in una costante stringa (caricamento dinamico).
func (i bytecodeIndex) references(symbol vulnerableSymbol) bool {
	if i.referenced[symbol.class] {
		return true
	}
	for member := range i.referenced {
		if symbol.matchesMember(member) {
			return true
		}
	}
	dotted := strings.ReplaceAll(symbol.class, "/", ".")
	for _, constant := range i.stringConstants {
		if constant == dotted || constant == symbol.class {
			return true
		}
	}
	return false
}

// classesUsedFrom elenca le classi della libreria vulnerabile che il progetto
// effettivamente usa, in ordine stabile.
func (i bytecodeIndex) classesUsedFrom(set libraryClassSet) []string {
	used := map[string]bool{}
	collect := func(member string) {
		class, _, found := strings.Cut(member, ".")
		if !found {
			class = member
		}
		if set.matches(class) {
			used[class] = true
		}
	}
	for member := range i.invoked {
		collect(member)
	}
	for reference := range i.referenced {
		collect(reference)
	}
	names := make([]string, 0, len(used))
	for name := range used {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) > maxUsedClasses {
		names = names[:maxUsedClasses]
	}
	return names
}

// classFileSummary è l'estratto di un .class che serve alla raggiungibilità.
type classFileSummary struct {
	invoked            map[string]bool
	references         map[string]bool
	strings            []string
	invokedynamicSites map[uint16]bool // indici di BootstrapMethods usati da invokedynamic
}

// Tag del constant pool (JVM specification §4.4).
const (
	tagUtf8               = 1
	tagInteger            = 3
	tagFloat              = 4
	tagLong               = 5
	tagDouble             = 6
	tagClass              = 7
	tagString             = 8
	tagFieldref           = 9
	tagMethodref          = 10
	tagInterfaceMethodref = 11
	tagNameAndType        = 12
	tagMethodHandle       = 15
	tagMethodType         = 16
	tagDynamic            = 17
	tagInvokeDynamic      = 18
	tagModule             = 19
	tagPackage            = 20
)

// cpEntry è una voce del constant pool con gli operandi che servono alla risoluzione
// dei riferimenti: il primo indice (nome, classe o handle) e il secondo
// (name_and_type o bootstrap).
type cpEntry struct {
	tag    byte
	first  uint16
	second uint16
}

// parseClassFile legge un file .class (JVM specification chapter 4) ed estrae i
// riferimenti a classi e membri, le invocazioni reali del codice e le costanti
// stringa. Un file malformato è ignorato: non invalida gli altri.
func parseClassFile(data []byte) (classFileSummary, error) {
	summary := classFileSummary{
		invoked:            map[string]bool{},
		references:         map[string]bool{},
		invokedynamicSites: map[uint16]bool{},
	}
	if len(data) < 10 || binary.BigEndian.Uint32(data) != 0xCAFEBABE {
		return summary, errors.New("not a class file")
	}
	reader := classReader{data: data, pos: 8}
	poolCount := reader.u2()
	pool := make([]cpEntry, poolCount)
	utf8s := make([]string, poolCount)
	for index := uint16(1); index < poolCount && reader.err == nil; index++ {
		entry := cpEntry{tag: reader.u1()}
		switch entry.tag {
		case tagUtf8:
			utf8s[index] = string(reader.bytes(int(reader.u2())))
		case tagClass, tagString, tagMethodHandle:
			// MethodHandle: reference_kind (u1) + reference_index (u2).
			if entry.tag == tagMethodHandle {
				_ = reader.u1()
			}
			entry.first = reader.u2()
		case tagFieldref, tagMethodref, tagInterfaceMethodref, tagNameAndType, tagDynamic, tagInvokeDynamic:
			entry.first, entry.second = reader.u2(), reader.u2()
		case tagMethodType, tagModule, tagPackage:
			_ = reader.u2()
		case tagLong, tagDouble:
			// Occupano due slot: il successivo è lasciato vuoto.
			_ = reader.u4()
			_ = reader.u4()
			index++
		case tagInteger, tagFloat:
			_ = reader.u4()
		default:
			return summary, fmt.Errorf("unknown constant pool tag %d", entry.tag)
		}
		pool[index] = entry
	}
	if reader.err != nil {
		return summary, reader.err
	}

	// Risoluzione dei nomi: i Class puntano a un nome interno, i membri a
	// class_index + name_and_type_index. Ogni accesso è difeso: un file corrotto non
	// deve far leggere fuori dal constant pool.
	utf8At := func(index uint16) string {
		if int(index) < len(utf8s) {
			return utf8s[index]
		}
		return ""
	}
	className := func(index uint16) string {
		if int(index) >= len(pool) || pool[index].tag != tagClass {
			return ""
		}
		return normalizeClassName(utf8At(pool[index].first))
	}
	memberOf := func(index uint16) string {
		if int(index) >= len(pool) {
			return ""
		}
		entry := pool[index]
		if entry.tag != tagFieldref && entry.tag != tagMethodref && entry.tag != tagInterfaceMethodref {
			return ""
		}
		class := className(entry.first)
		name := ""
		if int(entry.second) < len(pool) && pool[entry.second].tag == tagNameAndType {
			name = utf8At(pool[entry.second].first)
		}
		if class == "" || name == "" {
			return ""
		}
		// Ogni membro citato implica la citazione della sua classe.
		summary.references[class] = true
		return class + "." + name
	}

	// Classi citate dal constant pool: new, checkcast, instanceof, superclasse,
	// interfacce, tipi di campi e metodi sono tutti CONSTANT_Class.
	for index := range pool {
		if pool[index].tag == tagClass {
			if name := className(uint16(index)); name != "" {
				summary.references[name] = true
			}
		}
	}
	// Membri citati: anche non invocati restano riferimenti.
	for index := range pool {
		if member := memberOf(uint16(index)); member != "" {
			summary.references[member] = true
		}
	}
	for index := range pool {
		if pool[index].tag == tagMethodHandle {
			if member := memberOf(pool[index].first); member != "" {
				summary.references[member] = true
			}
		}
		if pool[index].tag == tagString {
			summary.strings = append(summary.strings, utf8At(pool[index].first))
		}
	}

	// Dopo il constant pool: access_flags, this_class, super_class, interfacce,
	// campi, metodi, attributi (JVM specification §4.1).
	reader.u2() // access_flags
	if self := className(reader.u2()); self != "" {
		summary.references[self] = true
	}
	if super := className(reader.u2()); super != "" {
		summary.references[super] = true
	}
	for count := reader.u2(); count > 0 && reader.err == nil; count-- {
		if name := className(reader.u2()); name != "" {
			summary.references[name] = true
		}
	}
	for count := reader.u2(); count > 0 && reader.err == nil; count-- {
		reader.skipMember() // field_info
	}

	codeAttributes := [][]byte{}
	bootstrapData := []byte{}
	for count := reader.u2(); count > 0 && reader.err == nil; count-- {
		reader.u2() // access_flags
		reader.u2() // name_index
		reader.u2() // descriptor_index
		for attributes := reader.u2(); attributes > 0 && reader.err == nil; attributes-- {
			nameIndex := reader.u2()
			payload := reader.bytes(int(reader.u4()))
			switch utf8At(nameIndex) {
			case "Code":
				codeAttributes = append(codeAttributes, payload)
			case "BootstrapMethods":
				bootstrapData = payload
			}
		}
	}
	for count := reader.u2(); count > 0 && reader.err == nil; count-- {
		nameIndex := reader.u2()
		payload := reader.bytes(int(reader.u4()))
		if utf8At(nameIndex) == "BootstrapMethods" {
			bootstrapData = payload
		}
	}
	if reader.err != nil {
		return summary, reader.err
	}

	for _, code := range codeAttributes {
		summary.recordInvokes(code, pool, memberOf)
	}
	if len(bootstrapData) > 0 {
		summary.recordBootstrapMethods(bootstrapData, pool, memberOf)
	}
	return summary, nil
}

// normalizeClassName riduce un nome di classe del constant pool alla forma interna:
// i tipi array ("[Lorg/foo/Bar;") diventano la classe elementale, i descrittori di
// tipo primitivo non sono classi.
func normalizeClassName(name string) string {
	for strings.HasPrefix(name, "[") {
		name = name[1:]
	}
	if strings.HasPrefix(name, "L") && strings.HasSuffix(name, ";") {
		name = name[1 : len(name)-1]
	}
	if name == "" || strings.ContainsAny(name, ";[") {
		return ""
	}
	if len(name) == 1 && strings.ContainsRune("BCDFIJSZ", rune(name[0])) {
		return ""
	}
	return name
}

// recordInvokes estrae dalle istruzioni di un attributo Code le invocazioni reali
// (JVM chapter 6).
//
// Il bytecode si decodifica istruzione per istruzione: cercare i byte degli opcode
// nel flusso grezzo produce falsi positivi, e una conferma falsa è la cosa peggiore.
// Se l'istruzione in testa non si decodifica si interrompe: ciò che non si è letto
// non diventa evidenza.
func (s *classFileSummary) recordInvokes(codeAttribute []byte, pool []cpEntry, memberOf func(uint16) string) {
	if len(codeAttribute) < 8 {
		return
	}
	codeLength := int(binary.BigEndian.Uint32(codeAttribute[4:]))
	if codeLength <= 0 || 8+codeLength > len(codeAttribute) {
		return
	}
	code := codeAttribute[8 : 8+codeLength]

	for pc := 0; pc < len(code); {
		opcode := code[pc]
		switch opcode {
		case 0xb6, 0xb7, 0xb8: // invokevirtual, invokespecial, invokestatic
			if pc+3 > len(code) {
				return
			}
			if member := memberOf(binary.BigEndian.Uint16(code[pc+1:])); member != "" {
				s.invoked[member] = true
			}
			pc += 3
		case 0xb9: // invokeinterface
			if pc+5 > len(code) {
				return
			}
			if member := memberOf(binary.BigEndian.Uint16(code[pc+1:])); member != "" {
				s.invoked[member] = true
			}
			pc += 5
		case 0xba: // invokedynamic: il bersaglio si risolve con BootstrapMethods
			if pc+5 > len(code) {
				return
			}
			index := binary.BigEndian.Uint16(code[pc+1:])
			if int(index) < len(pool) && pool[index].tag == tagInvokeDynamic {
				s.invokedynamicSites[pool[index].first] = true
			}
			pc += 5
		case 0xaa: // tableswitch
			next, ok := skipTableSwitch(code, pc)
			if !ok {
				return
			}
			pc = next
		case 0xab: // lookupswitch
			next, ok := skipLookupSwitch(code, pc)
			if !ok {
				return
			}
			pc = next
		case 0xc4: // wide
			next, ok := skipWide(code, pc)
			if !ok {
				return
			}
			pc = next
		default:
			size := instructionSize(opcode)
			if size == 0 || pc+size > len(code) {
				return
			}
			pc += size
		}
	}
}

// recordBootstrapMethods risolve i bersagli delle invokedynamic: il metodo
// bootstrap, i suoi handle e gli handle passati come argomenti (i method reference
// delle lambda) sono invocazioni reali quando il sito invokedynamic esiste.
func (s *classFileSummary) recordBootstrapMethods(data []byte, pool []cpEntry, memberOf func(uint16) string) {
	reader := classReader{data: data}
	count := reader.u2()
	for index := uint16(0); index < count && reader.err == nil; index++ {
		handle := reader.u2()
		arguments := reader.u2()
		argumentIndexes := make([]uint16, 0, arguments)
		for argument := uint16(0); argument < arguments; argument++ {
			argumentIndexes = append(argumentIndexes, reader.u2())
		}
		if !s.invokedynamicSites[index] {
			continue
		}
		addHandle := func(entry cpEntry) {
			if entry.tag == tagMethodHandle {
				if member := memberOf(entry.first); member != "" {
					s.invoked[member] = true
				}
			}
		}
		if int(handle) < len(pool) {
			addHandle(pool[handle])
		}
		for _, argumentIndex := range argumentIndexes {
			if int(argumentIndex) < len(pool) {
				addHandle(pool[argumentIndex])
			}
		}
	}
}

// instructionSize è la lunghezza in byte di un'istruzioni opcode incluso l'opcode
// (JVM chapter 6). Zero segnala un'istruzione a lunghezza variabile o inesistente,
// gestite a parte o rifiutate.
func instructionSize(opcode byte) int {
	switch {
	case opcode == 0x10, // bipush
		opcode == 0x12,                 // ldc
		opcode == 0x15, opcode == 0x16, // iload, lload
		opcode == 0x17, opcode == 0x18, // fload, dload
		opcode == 0x19,                 // aload
		opcode == 0x36, opcode == 0x37, // istore, lstore
		opcode == 0x38, opcode == 0x39, // fstore, dstore
		opcode == 0x3a, // astore
		opcode == 0xa9, // ret
		opcode == 0xbc: // newarray
		return 2
	case opcode == 0x11, opcode == 0x13, opcode == 0x14, // sipush, ldc_w, ldc2_w
		opcode == 0x84,                                 // iinc
		opcode >= 0x99 && opcode <= 0xa8,               // if* … goto, jsr
		opcode == 0xb2, opcode == 0xb3, opcode == 0xb4, // getstatic, putstatic, getfield
		opcode == 0xb5, opcode == 0xb6, opcode == 0xb7, // putfield, invokevirtual, invokespecial
		opcode == 0xb8, opcode == 0xbb, opcode == 0xbd, // invokestatic, new, anewarray
		opcode == 0xc0, opcode == 0xc1, // checkcast, instanceof
		opcode == 0xc6, opcode == 0xc7: // ifnull, ifnonnull
		return 3
	case opcode == 0xb9, opcode == 0xba, opcode == 0xc8, opcode == 0xc9: // invokeinterface, invokedynamic, goto_w, jsr_w
		return 5
	case opcode == 0xc5: // multianewarray
		return 4
	case opcode >= 0x00 && opcode <= 0x0f, // nop … dconst_1
		opcode >= 0x1a && opcode <= 0x35, // *load_0..3, *aload
		opcode >= 0x3b && opcode <= 0x83, // *store_0..3, *astore, *aload, stack, aritmetica
		opcode >= 0x85 && opcode <= 0x98, // conversioni e confronti
		opcode >= 0xac && opcode <= 0xb1, // *return
		opcode >= 0xbe && opcode <= 0xbf, // arraylength, athrow
		opcode >= 0xc2 && opcode <= 0xc3, // monitorenter, monitorexit
		opcode == 0xca:                   // breakpoint
		return 1
	}
	return 0
}

// skipTableSwitch salta un'istruzione tableswitch: l'allineamento a 4 byte è
// relativo all'inizio del codice (JVM §4.9.1, §6.5).
func skipTableSwitch(code []byte, pc int) (int, bool) {
	position := pc + 1
	for position%4 != 0 {
		position++
	}
	if position+12 > len(code) {
		return 0, false
	}
	low := int(int32(binary.BigEndian.Uint32(code[position+4:])))
	high := int(int32(binary.BigEndian.Uint32(code[position+8:])))
	if high < low || high-low > 65535 {
		return 0, false
	}
	next := position + 12 + (high-low+1)*4
	if next > len(code) {
		return 0, false
	}
	return next, true
}

// skipLookupSwitch salta un'istruzione lookupswitch.
func skipLookupSwitch(code []byte, pc int) (int, bool) {
	position := pc + 1
	for position%4 != 0 {
		position++
	}
	if position+8 > len(code) {
		return 0, false
	}
	pairs := int(int32(binary.BigEndian.Uint32(code[position+4:])))
	if pairs < 0 || pairs > 65535 {
		return 0, false
	}
	next := position + 8 + pairs*8
	if next > len(code) {
		return 0, false
	}
	return next, true
}

// skipWide salta un'istruzione wide: iinc ha un operando in più.
func skipWide(code []byte, pc int) (int, bool) {
	if pc+2 > len(code) {
		return 0, false
	}
	if code[pc+1] == 0x84 { // wide iinc: index (u2) + const (u2)
		if pc+6 > len(code) {
			return 0, false
		}
		return pc + 6, true
	}
	if pc+4 > len(code) {
		return 0, false
	}
	return pc + 4, true
}

// classReader scorre i campi binari di un .class con il byte order della JVM (big
// endian). Il primo campo fuori dal file imposta err e ferma la lettura.
type classReader struct {
	data []byte
	pos  int
	err  error
}

func (r *classReader) u1() byte {
	if r.err != nil || r.pos+1 > len(r.data) {
		r.err = errors.New("truncated class file")
		return 0
	}
	value := r.data[r.pos]
	r.pos++
	return value
}

func (r *classReader) u2() uint16 {
	if r.err != nil || r.pos+2 > len(r.data) {
		r.err = errors.New("truncated class file")
		return 0
	}
	value := binary.BigEndian.Uint16(r.data[r.pos:])
	r.pos += 2
	return value
}

func (r *classReader) u4() uint32 {
	if r.err != nil || r.pos+4 > len(r.data) {
		r.err = errors.New("truncated class file")
		return 0
	}
	value := binary.BigEndian.Uint32(r.data[r.pos:])
	r.pos += 4
	return value
}

func (r *classReader) bytes(length int) []byte {
	if r.err != nil || length < 0 || r.pos+length > len(r.data) {
		r.err = errors.New("truncated class file")
		return nil
	}
	value := r.data[r.pos : r.pos+length]
	r.pos += length
	return value
}

// skipMember salta un field_info o method_info (JVM §4.5, §4.6).
func (r *classReader) skipMember() {
	r.u2()
	r.u2()
	r.u2()
	for attributes := r.u2(); attributes > 0 && r.err == nil; attributes-- {
		r.u2()
		r.bytes(int(r.u4()))
	}
}

// appendDistinctString aggiunge value se non vuoto e non già presente.
func appendDistinctString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
