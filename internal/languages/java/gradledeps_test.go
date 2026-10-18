package java

import "testing"

const sampleGradle = `plugins {
    id 'org.springframework.boot' version '3.2.0'
    id("io.spring.dependency-management") version "1.1.4"
}
ext {
    jacksonVersion = '2.16.1'
}
val junitVersion = "5.10.1"
dependencies {
    implementation platform('org.springframework.boot:spring-boot-dependencies:3.2.0')
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation("com.fasterxml.jackson.core:jackson-databind:$jacksonVersion")
    testImplementation "org.junit.jupiter:junit-jupiter:${junitVersion}"
    runtimeOnly group: 'com.h2database', name: 'h2', version: '2.2.224'
    // implementation 'commented:out:1.0'
    compileOnly 'org.projectlombok:lombok:1.18.30'
}
`

func TestParseGradleDependencies(t *testing.T) {
	found, err := ParseGradleDependencies([]byte(sampleGradle))
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]PomDependency{}
	for _, dependency := range found {
		byKey[dependency.Key()] = dependency
	}
	if _, commented := byKey["commented:out"]; commented {
		t.Fatal("a commented-out dependency must be ignored")
	}
	if got := byKey["org.springframework.boot:spring-boot-dependencies"]; got.Section != SectionManagement || got.Version != "3.2.0" || got.Scope != "implementation" {
		t.Fatalf("platform: %+v", got)
	}
	if got := byKey["org.springframework.boot:spring-boot-starter-web"]; got.Version != "" || got.StartCol == 0 {
		t.Fatalf("managed version must stay empty but located: %+v", got)
	}
	jackson := byKey["com.fasterxml.jackson.core:jackson-databind"]
	if jackson.Property != "jacksonVersion" || jackson.Resolved != "2.16.1" || jackson.PropertyLine != 6 {
		t.Fatalf("variable version: %+v", jackson)
	}
	if junit := byKey["org.junit.jupiter:junit-jupiter"]; junit.Property != "junitVersion" || junit.Resolved != "5.10.1" || junit.PropertyLine != 8 || junit.Scope != "testImplementation" {
		t.Fatalf("braced variable: %+v", junit)
	}
	if h2 := byKey["com.h2database:h2"]; h2.Version != "2.2.224" || h2.Scope != "runtimeOnly" {
		t.Fatalf("map notation: %+v", h2)
	}
	if boot := byKey["org.springframework.boot:org.springframework.boot.gradle.plugin"]; boot.Section != SectionPlugin || boot.Version != "3.2.0" {
		t.Fatalf("plugin: %+v", boot)
	}
	if plugin := byKey["io.spring.dependency-management:io.spring.dependency-management.gradle.plugin"]; plugin.Version != "1.1.4" {
		t.Fatalf("kotlin-style plugin: %+v", plugin)
	}
	if lombok := byKey["org.projectlombok:lombok"]; lombok.Version != "1.18.30" || lombok.Line != 16 {
		t.Fatalf("version position: %+v", lombok)
	}
}
