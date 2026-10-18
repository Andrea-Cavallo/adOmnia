package java

import "testing"

func TestParsePropertyValuesFindsKeysAndValues(t *testing.T) {
	const sample = `# porta del server
server.port=8080
acme.mail.host: smtp.acme.io
acme.mail.path = /v1/mail
spring.application.name=orders
`
	values := parsePropertyValues([]byte(sample), "application.properties", "")
	if len(values) != 4 {
		t.Fatalf("values: %+v", values)
	}
	if values[0].Key != "server.port" || values[0].Value != "8080" || values[0].Line != 2 {
		t.Fatalf("first: %+v", values[0])
	}
	if values[1].Key != "acme.mail.host" || values[1].Value != "smtp.acme.io" {
		t.Fatalf("colon separator: %+v", values[1])
	}
	if values[2].Value != "/v1/mail" {
		t.Fatalf("spaces around =: %+v", values[2])
	}
	if values[3].Key != "spring.application.name" {
		t.Fatalf("last: %+v", values[3])
	}
	if values[0].StartColumn == 0 || values[0].EndColumn <= values[0].StartColumn {
		t.Fatalf("key location: %+v", values[0])
	}
}

func TestParsePropertyValuesHandlesContinuation(t *testing.T) {
	const sample = `acme.list=a,\
b,c
after=1
`
	values := parsePropertyValues([]byte(sample), "application.properties", "")
	if len(values) != 2 {
		t.Fatalf("values: %+v", values)
	}
	if values[0].Key != "acme.list" || values[0].Value != "a,b,c" {
		t.Fatalf("continuation: %+v", values[0])
	}
}

func TestParseYamlValuesFlattensTheNesting(t *testing.T) {
	const sample = `spring:
  application:
    name: orders
  datasource:
    url: jdbc:h2:mem:test
server:
  port: 8080
`
	values := parseYamlValues([]byte(sample), "application.yml", "")
	if len(values) != 3 {
		t.Fatalf("values: %+v", values)
	}
	byKey := map[string]SpringValue{}
	for _, value := range values {
		byKey[value.Key] = value
	}
	if byKey["spring.datasource.url"].Value != "jdbc:h2:mem:test" {
		t.Fatalf("nested key: %+v", byKey["spring.datasource.url"])
	}
	if byKey["server.port"].Value != "8080" {
		t.Fatalf("top level key: %+v", byKey["server.port"])
	}
	if byKey["spring.application.name"].Line == 0 {
		t.Fatalf("location: %+v", byKey["spring.application.name"])
	}
}

func TestParseYamlValuesReadsProfileDocuments(t *testing.T) {
	const sample = `server:
  port: 8080
---
spring:
  config:
    activate:
      on-profile: prod
server:
  port: 80
`
	values := parseYamlValues([]byte(sample), "application.yml", "")
	var prod, base SpringValue
	for _, value := range values {
		if value.Key != "server.port" {
			continue
		}
		if value.Profile == "prod" {
			prod = value
		} else {
			base = value
		}
	}
	if prod.Value != "80" || base.Value != "8080" {
		t.Fatalf("prod=%+v base=%+v", prod, base)
	}
	for _, value := range values {
		if isActivationKey(value.Key) {
			t.Fatalf("activation keys are not properties: %+v", value)
		}
	}
}

func TestProfileOfFollowsTheFileName(t *testing.T) {
	cases := map[string]string{
		"application.properties":      "",
		"application-dev.properties":  "dev",
		"application-prod.yaml":       "prod",
		"application-PROD.properties": "prod",
	}
	for name, want := range cases {
		if got := profileOf(name); got != want {
			t.Fatalf("profileOf(%q)=%q want %q", name, got, want)
		}
	}
}
