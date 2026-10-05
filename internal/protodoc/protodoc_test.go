package protodoc

import (
	"os"
	"path/filepath"
	"testing"
)

const orders = `// Orders API.
syntax = "proto3";

package shop.v1;

import "missing/common.proto";

// OrderService manages orders.
service OrderService {
  // GetOrder returns one order.
  rpc GetOrder(GetOrderRequest) returns (Order);
  rpc Watch(GetOrderRequest) returns (stream Order); // live updates
}

message GetOrderRequest {
  string id = 1; // the order id
}

// Order is a purchase.
message Order {
  string id = 1;
  repeated Item items = 2;
  map<string, int64> totals = 3;
  optional common.Money discount = 4;
  // Item of an order.
  message Item { string sku = 1; }
  enum Status {
    STATUS_UNSPECIFIED = 0;
    // Paid by the customer.
    STATUS_PAID = 1;
  }
}
`

func TestCollect(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "api", "v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "api", "v1", "orders.proto"), []byte(orders), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "broken.proto"), []byte("message {"), 0o644); err != nil {
		t.Fatal(err)
	}
	files := Collect(root)
	if len(files) != 2 || files[0].Path != "api/v1/orders.proto" || files[1].Error == "" {
		t.Fatalf("files: %+v", files)
	}
	file := files[0]
	if file.Package != "shop.v1" || file.Syntax != "proto3" || file.Doc != "Orders API." {
		t.Fatalf("header: %+v", file)
	}
	service := file.Services[0]
	if service.Doc != "OrderService manages orders." || service.Line != 9 || len(service.Methods) != 2 {
		t.Fatalf("service: %+v", service)
	}
	if service.Methods[0].Doc != "GetOrder returns one order." || service.Methods[1].Doc != "live updates" || !service.Methods[1].ServerStreaming || service.Methods[1].Output != "Order" {
		t.Fatalf("methods: %+v", service.Methods)
	}
	if len(file.Messages) != 3 || file.Messages[1].Name != "Order" || file.Messages[2].Name != "Order.Item" {
		t.Fatalf("messages: %+v", file.Messages)
	}
	fields := file.Messages[1].Fields
	if fields[1].Label != "repeated" || fields[1].Type != "Item" || fields[2].Type != "map<string, int64>" || fields[2].Label != "" || fields[3].Label != "optional" || fields[3].Type != "common.Money" {
		t.Fatalf("fields: %+v", fields)
	}
	if file.Messages[0].Fields[0].Doc != "the order id" {
		t.Fatalf("field doc: %+v", file.Messages[0].Fields[0])
	}
	if len(file.Enums) != 1 || file.Enums[0].Name != "Order.Status" || file.Enums[0].Values[1].Doc != "Paid by the customer." {
		t.Fatalf("enums: %+v", file.Enums)
	}
}
