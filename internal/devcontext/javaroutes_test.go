package devcontext

import "testing"

func TestDetectJavaFileFindsSpringRoutes(t *testing.T) {
	src := []byte(`package demo;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping("/{id}")
    public Order get(@PathVariable long id) { return null; }

    @PostMapping
    public Order create() { return null; }
}
`)
	routes := detectJavaFile("src/main/java/demo/OrderController.java", src)
	if len(routes) != 2 {
		t.Fatalf("want 2 routes, got %d: %+v", len(routes), routes)
	}
	if routes[0].ID != "route:GET /api/orders/{id}" || routes[1].Attrs["method"] != "POST" {
		t.Fatalf("unexpected routes: %+v", routes)
	}
	if routes[0].Attrs["declFile"] == "" || routes[0].Attrs["declLine"] == "0" {
		t.Fatalf("handler location missing: %+v", routes[0].Attrs)
	}
	if got := detectJavaFile("A.java", []byte("class A {}")); len(got) != 0 {
		t.Fatalf("plain class must give no routes: %+v", got)
	}
}
