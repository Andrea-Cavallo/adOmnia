package devcontext

import "testing"

const orderEndpoint = `package com.acme.ws;

import javax.jws.WebMethod;
import javax.jws.WebService;

@WebService(serviceName = "OrderService", targetNamespace = "http://acme.com/orders", wsdlLocation = "WEB-INF/wsdl/orders.wsdl")
public class OrderEndpoint {
    @WebMethod(operationName = "GetOrder")
    public Order get(String id) { return null; }

    @WebMethod(exclude = true)
    public void internal() {}
}
`

const auditEndpoint = `package com.acme.ws;

@javax.ejb.Stateless
@javax.jws.WebService
public class AuditBean {
    public void record(String event) {}
}
`

const orderMDB = `package com.acme.jms;

@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "javax.jms.Queue"),
    @ActivationConfigProperty(propertyName = "destination", propertyValue = "jms/OrdersQueue")
})
public class OrderListener implements MessageListener {
    public void onMessage(Message message) {}
}
`

const ordersWSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" targetNamespace="http://acme.com/orders" name="OrderService">
  <service name="OrderService"><port name="OrderPort" binding="tns:OrderBinding"/></service>
</definitions>`

const sunJAXWS = `<?xml version="1.0"?>
<endpoints xmlns="http://java.sun.com/xml/ns/jax-ws/ri/runtime" version="2.0">
  <endpoint name="orders" implementation="com.acme.ws.OrderEndpoint" url-pattern="/services/orders"/>
</endpoints>`

func TestJAXWSEndpointsBecomeSOAPRoutesLinkedToTheirWSDL(t *testing.T) {
	entities := servletSnapshot(t, map[string]string{
		"src/main/java/com/acme/ws/OrderEndpoint.java":  orderEndpoint,
		"src/main/java/com/acme/ws/AuditBean.java":      auditEndpoint,
		"src/main/java/com/acme/jms/OrderListener.java": orderMDB,
		"src/main/webapp/WEB-INF/wsdl/orders.wsdl":      ordersWSDL,
		"src/main/webapp/WEB-INF/sun-jaxws.xml":         sunJAXWS,
	})
	orders, ok := entities["route:POST /services/orders"]
	if !ok {
		t.Fatalf("entities = %v", routeIDs(entities))
	}
	if orders.Attrs["soapService"] != "OrderService" || orders.Attrs["soapOperations"] != "GetOrder" || orders.Attrs["contract"] != "src/main/webapp/WEB-INF/wsdl/orders.wsdl" || orders.Attrs["declLine"] != "7" || orders.Attrs["requestContentType"] != soapContentType {
		t.Fatalf("orders = %+v", orders.Attrs)
	}
	audit := entities["route:POST /AuditBeanService"]
	if audit.Confidence != ConfidenceInferred || audit.Attrs["soapOperations"] != "record" {
		t.Fatalf("an EJB endpoint without mapping answers at /<serviceName>: %+v", audit)
	}
	contract := entities["contract:src/main/webapp/WEB-INF/wsdl/orders.wsdl"]
	if contract.Attrs["declName"] != "com.acme.ws.OrderEndpoint" || contract.Attrs["services"] != "OrderService" {
		t.Fatalf("the WSDL opens the class that serves it: %+v", contract.Attrs)
	}
	queue := entities["topic:jms/OrdersQueue"]
	if queue.Attrs["broker"] != "jms" || queue.Attrs["destinationType"] != "queue" || queue.Attrs["declName"] != "com.acme.jms.OrderListener" {
		t.Fatalf("the MDB destination is a topic entity: %+v", queue)
	}
	for id, e := range entities {
		if e.Kind == soapImplKind || e.Kind == soapMappingKind {
			t.Fatalf("internal entity leaked: %s", id)
		}
	}
}
