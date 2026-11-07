package devcontext

import (
	"strings"
	"testing"
)

func TestJavaEndpointRequestShapeAndBody(t *testing.T) {
	controller := []byte(`package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @PostMapping("/{id}")
    public Order update(@PathVariable("id") long id,
                        @RequestParam(name = "dryRun", defaultValue = "false") boolean dryRun,
                        @RequestHeader("X-Token") String token,
                        @RequestBody Order order) { return null; }
}
`)
	dto := []byte(`package demo;

class Order {
    private String name;
    private int quantity;
    private List<String> tags;
}
`)
	entities := linkHandlers(merge(
		detectJavaFile("src/main/java/demo/OrderController.java", controller),
		detectJavaFile("src/main/java/demo/Order.java", dto),
	))
	var route Entity
	for _, entity := range entities {
		if entity.Kind == bodyDeclKind {
			t.Fatalf("body declarations must not reach the snapshot: %+v", entity)
		}
		if entity.ID == "route:POST /api/orders/{id}" {
			route = entity
		}
	}
	if route.ID != "route:POST /api/orders/{id}" {
		t.Fatalf("route not found: %+v", route)
	}
	params := route.Attrs["requestParams"]
	for _, want := range []string{`"name":"id"`, `"in":"path"`, `"name":"dryRun"`, `"default":"false"`, `"name":"X-Token"`, `"in":"header"`} {
		if !strings.Contains(params, want) {
			t.Errorf("requestParams missing %s: %s", want, params)
		}
	}
	if route.Attrs["requestBodyType"] != "Order" {
		t.Fatalf("body type: %+v", route.Attrs)
	}
	if route.Attrs["requestBody"] != `{"name":"","quantity":0,"tags":[]}` {
		t.Fatalf("requestBody = %s", route.Attrs["requestBody"])
	}
}

func TestJavaBodyDeclsUseJsonPropertyNames(t *testing.T) {
	src := []byte(`package demo;
class CreateOrder {
    @JsonProperty("customer_name") private String customerName;
    private boolean urgent;
    @JsonIgnore private String internalNote;
}
`)
	routes := detectJavaFile("src/main/java/demo/CreateOrder.java", src)
	var example string
	for _, entity := range routes {
		if entity.Kind == bodyDeclKind {
			example = entity.Attrs["example"]
		}
	}
	if example != `{"customer_name":"","urgent":false}` {
		t.Fatalf("example = %s", example)
	}
}

func TestJaxRsImplicitBodyAndFormParams(t *testing.T) {
	resource := []byte(`package demo;

import jakarta.ws.rs.*;

@Path("/fruits")
public class FruitResource {
    @POST
    public Fruit create(Fruit fruit) { return null; }

    @POST
    @Path("/form")
    public void createForm(@FormParam("name") String name) {}
}
`)
	dto := []byte(`package demo;
class Fruit {
    private String name;
}
`)
	entities := linkHandlers(merge(
		detectJavaFile("src/main/java/demo/FruitResource.java", resource),
		detectJavaFile("src/main/java/demo/Fruit.java", dto),
	))
	byID := map[string]Entity{}
	for _, entity := range entities {
		byID[entity.ID] = entity
	}
	create := byID["route:POST /fruits"]
	if create.Attrs["requestBodyType"] != "Fruit" || create.Attrs["requestBody"] != `{"name":""}` {
		t.Fatalf("implicit JAX-RS body: %+v", create.Attrs)
	}
	form := byID["route:POST /fruits/form"]
	if !strings.Contains(form.Attrs["requestParams"], `"in":"form"`) {
		t.Fatalf("form param: %+v", form.Attrs)
	}
}

func TestSpringContextPathIsAppliedToJavaRoutes(t *testing.T) {
	config := []byte("server.port=8080\nserver.servlet.context-path=/gateway\n")
	controller := []byte(`package demo;
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping
    public String list() { return ""; }
}
`)
	configEntities, _ := detectFile("src/main/resources/application.properties", config, nil, AdapterHints{})
	entities := linkHandlers(merge(
		configEntities,
		detectJavaFile("src/main/java/demo/OrderController.java", controller),
	))
	for _, entity := range entities {
		if entity.Kind == springConfigKind {
			t.Fatalf("config entity leaked: %+v", entity)
		}
	}
	if len(entities) != 1 || entities[0].ID != "route:GET /gateway/api/orders" {
		t.Fatalf("context path not applied: %+v", entities)
	}
}

func TestSpringContextPathFromYaml(t *testing.T) {
	config := []byte("server:\n  servlet:\n    context-path: /gw\n")
	entities, _ := detectFile("src/main/resources/application.yml", config, nil, AdapterHints{})
	prefix := javaContextPath(entities)
	if prefix != "/gw" {
		t.Fatalf("context path = %q (%+v)", prefix, entities)
	}
}

func TestJavaNestedDTOsAreInlined(t *testing.T) {
	user := []byte(`package demo;
class User { private Address address; private String name; }
`)
	address := []byte(`package demo;
class Address { private String city; }
`)
	entities := linkHandlers(merge(
		detectJavaFile("src/main/java/demo/User.java", user),
		detectJavaFile("src/main/java/demo/Address.java", address),
		detectJavaFile("src/main/java/demo/UserController.java", []byte(`package demo;
@RestController
public class UserController {
    @PostMapping("/users")
    public void create(@RequestBody User user) {}
}
`)),
	))
	for _, entity := range entities {
		if entity.ID == "route:POST /users" {
			if entity.Attrs["requestBody"] != `{"address":{"city":""},"name":""}` {
				t.Fatalf("nested body = %s", entity.Attrs["requestBody"])
			}
			return
		}
	}
	t.Fatal("route not found")
}
