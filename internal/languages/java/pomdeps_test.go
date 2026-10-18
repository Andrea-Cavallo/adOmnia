package java

import "testing"

const pomSample = `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.1.0</version>
  </parent>
  <properties>
    <jackson.version>2.15.0</jackson.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>${jackson.version}</version>
      <exclusions><exclusion><groupId>x</groupId><artifactId>y</artifactId></exclusion></exclusions>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`

func TestParsePomDependenciesLocatesVersionsAndProperties(t *testing.T) {
	deps, err := ParsePomDependencies([]byte(pomSample))
	if err != nil {
		t.Fatal(err)
	}
	if len(deps) != 3 {
		t.Fatalf("want parent + 2 dependencies, got %d: %+v", len(deps), deps)
	}
	parent, jackson, web := deps[0], deps[1], deps[2]
	if parent.Section != SectionParent || parent.Version != "3.1.0" || parent.Line != 5 || parent.StartCol != 14 || parent.EndCol != 19 {
		t.Fatalf("parent: %+v", parent)
	}
	if jackson.Key() != "com.fasterxml.jackson.core:jackson-databind" || jackson.Property != "jackson.version" || jackson.Resolved != "2.15.0" {
		t.Fatalf("jackson: %+v", jackson)
	}
	if jackson.PropertyLine != 8 || jackson.PropertyStartCol != 22 || jackson.PropertyEndCol != 28 {
		t.Fatalf("the property text must be located for the edit: %+v", jackson)
	}
	if web.Version != "" || web.Resolved != "" || web.Line != 19 {
		t.Fatalf("managed version stays empty and points at the artifactId: %+v", web)
	}
}
