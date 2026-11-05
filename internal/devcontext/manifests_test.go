package devcontext

import "testing"

func findDatasource(entities []Entity) *Entity {
	for index := range entities {
		if entities[index].Kind == "datasource" {
			return &entities[index]
		}
	}
	return nil
}

func TestAppSettingsConnectionStringBecomesADatasource(t *testing.T) {
	entities, err := detectAppSettings("appsettings.json", []byte(`{
		"ConnectionStrings": {
			"Default": "Server=db.local,1433;Database=shop;User Id=app;Password=s3cret"
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	ds := findDatasource(entities)
	if ds == nil {
		t.Fatal("no datasource")
	}
	if ds.Attrs["type"] != "sqlserver" || ds.Attrs["host"] != "db.local" || ds.Attrs["port"] != "1433" || ds.Attrs["database"] != "shop" || ds.Attrs["user"] != "app" {
		t.Fatalf("datasource = %+v", ds)
	}
	for key, value := range ds.Attrs {
		if value == "s3cret" || key == "password" {
			t.Fatalf("password leaked: %s=%s", key, value)
		}
	}
}

func TestRailsDatabaseYmlBecomesADatasource(t *testing.T) {
	entities, err := detectRailsDatabase("config/database.yml", []byte(`default: &default
  adapter: postgresql
  host: pg.local
  username: app
development:
  <<: *default
  database: shop_development
test:
  <<: *default
  database: shop_test
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("entities = %+v", entities)
	}
	ds := entities[0]
	if ds.Attrs["type"] != "postgres" || ds.Attrs["host"] != "pg.local" || ds.Attrs["database"] != "shop_development" || ds.Attrs["user"] != "app" {
		t.Fatalf("datasource = %+v", ds)
	}
}

func TestAppSettingsKafkaTopicsBecomeEntities(t *testing.T) {
	entities, err := detectAppSettings("appsettings.json", []byte(`{
		"Kafka": {"BootstrapServers": "localhost:9092", "Topics": ["orders", "payments"]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	var topics []Entity
	for _, entity := range entities {
		if entity.Kind == "topic" {
			topics = append(topics, entity)
		}
	}
	if len(topics) != 2 || topics[0].ID != "topic:orders" || topics[1].ID != "topic:payments" {
		t.Fatalf("topics = %+v", topics)
	}
	if topics[0].Attrs["broker"] != "kafka" {
		t.Fatalf("attrs = %+v", topics[0].Attrs)
	}
}

func TestEnvKafkaTopicsBecomeEntities(t *testing.T) {
	entities, err := detectDotenv(".env", []byte("KAFKA_BROKERS=localhost:9092\nKAFKA_TOPICS=orders,payments\n"))
	if err != nil {
		t.Fatal(err)
	}
	var topics []Entity
	for _, entity := range entities {
		if entity.Kind == "topic" {
			topics = append(topics, entity)
		}
	}
	if len(topics) != 2 {
		t.Fatalf("topics = %+v", topics)
	}
}

func TestLaravelEnvKeysBecomeOneDatasource(t *testing.T) {
	entities, err := detectDotenv(".env", []byte("DB_CONNECTION=mysql\nDB_HOST=db.local\nDB_PORT=3306\nDB_DATABASE=shop\nDB_USERNAME=app\nDB_PASSWORD=s3cret\n"))
	if err != nil {
		t.Fatal(err)
	}
	ds := findDatasource(entities)
	if ds == nil {
		t.Fatal("no datasource")
	}
	if ds.Attrs["type"] != "mysql" || ds.Attrs["host"] != "db.local" || ds.Attrs["database"] != "shop" || ds.Attrs["user"] != "app" {
		t.Fatalf("datasource = %+v", ds)
	}
	if _, leaked := ds.Attrs["password"]; leaked {
		t.Fatal("password must not be an attribute")
	}
}
