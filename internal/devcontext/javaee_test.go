package devcontext

import "testing"

const legacyPersistence = `<?xml version="1.0" encoding="UTF-8"?>
<persistence xmlns="http://java.sun.com/xml/ns/persistence" version="2.0">
  <persistence-unit name="ordersJTA">
    <jta-data-source>jdbc/OrdersDS</jta-data-source>
  </persistence-unit>
  <persistence-unit name="reports" transaction-type="RESOURCE_LOCAL">
    <properties>
      <property name="javax.persistence.jdbc.url" value="jdbc:oracle:thin:@db.acme.local:1521:ORCL"/>
      <property name="javax.persistence.jdbc.user" value="reports"/>
      <property name="javax.persistence.jdbc.password" value="secret"/>
    </properties>
  </persistence-unit>
  <persistence-unit name="audit">
    <properties>
      <property name="hibernate.connection.url" value="jdbc:postgresql://localhost:5432/audit"/>
    </properties>
  </persistence-unit>
</persistence>`

const orderEntity = `package com.acme.model;

@Entity
@Table(name = "ORDERS", schema = "SALES")
public class Order {
    @Id private Long id;
}
`

const plainEntity = `package com.acme.model;

@javax.persistence.Entity(name = "Customer")
public class CustomerRecord {}
`

const legacyApplicationXML = `<?xml version="1.0"?>
<application xmlns="http://java.sun.com/xml/ns/javaee" version="6">
  <module><web><web-uri>billing-1.0.war</web-uri><context-root>/billing</context-root></web></module>
  <module><ejb>billing-ejb.jar</ejb></module>
</application>`

func TestJPAUnitsAndEntitiesBecomeDatasourcesAndTables(t *testing.T) {
	entities := servletSnapshot(t, map[string]string{
		"src/main/resources/META-INF/persistence.xml": legacyPersistence,
		"src/main/java/com/acme/model/Order.java":     orderEntity,
		"src/main/java/com/acme/model/Customer.java":  plainEntity,
	})
	oracle := entities["datasource:oracle@db.acme.local:1521/ORCL"]
	if oracle.Attrs["user"] != "reports" || oracle.Attrs["persistenceUnit"] != "reports" || oracle.Attrs["password"] != "" {
		t.Fatalf("entities = %v, oracle = %+v", routeIDs(entities), oracle)
	}
	if entities["datasource:postgres@localhost:5432/audit"].ID == "" {
		t.Fatalf("Hibernate URL: %v", routeIDs(entities))
	}
	if table := entities["table:SALES.ORDERS"]; table.Attrs["declName"] != "com.acme.model.Order" || table.Attrs["orm"] != "jpa" {
		t.Fatalf("table = %+v", table)
	}
	if entities["table:Customer"].ID == "" {
		t.Fatalf("@Entity(name) is the default table: %v", routeIDs(entities))
	}
}

func TestJSPPagesAndEARContextRoots(t *testing.T) {
	entities := servletSnapshot(t, map[string]string{
		"billing-ear/EarContent/META-INF/application.xml": legacyApplicationXML,
		"billing/WebContent/orders/list.jsp":              "<html/>",
		"billing/WebContent/WEB-INF/views/secret.jsp":     "<html/>",
		"billing/WebContent/WEB-INF/web.xml":              legacyWebXML,
		"billing/src/com/acme/web/OrderServlet.java":      orderServlet,
		"admin/WebContent/index.jsp":                      "<html/>",
	})
	page := entities["route:GET /billing/orders/list.jsp"]
	if page.Attrs["declFile"] != "billing/WebContent/orders/list.jsp" || page.Attrs["contextRoot"] != "/billing" {
		t.Fatalf("entities = %v", routeIDs(entities))
	}
	if entities["route:GET /billing/orders/**"].ID == "" {
		t.Fatalf("servlet routes of the module get the context root: %v", routeIDs(entities))
	}
	if entities["route:GET /index.jsp"].ID == "" {
		t.Fatalf("a WAR outside the EAR keeps its path: %v", routeIDs(entities))
	}
	for id := range entities {
		if id == "route:GET /billing/WEB-INF/views/secret.jsp" || id == "route:GET /WEB-INF/views/secret.jsp" {
			t.Fatal("pages under WEB-INF are not public")
		}
	}
}
