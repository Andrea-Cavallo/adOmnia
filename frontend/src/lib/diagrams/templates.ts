/**
 * Starting points for the diagrams adOmnia users draw most: service architectures, event-driven
 * sagas, Camel integrations, protocol flows, OSGi bundles and UML. Each is a blueprint, laid out by
 * ELK when it is created.
 */
import type { DiagramBlueprint } from './blueprint'

export interface DiagramTemplate {
  id: string
  label: string
  description: string
  blueprint: DiagramBlueprint
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'microservices',
    label: 'Go & Java microservices',
    description: 'Gateway, Go and Spring services, their databases and a Kafka topic between them.',
    blueprint: {
      nodes: [
        { key: 'client', shape: 'client', label: 'Web client' },
        { key: 'gateway', shape: 'gateway', label: 'API Gateway' },
        { key: 'orders', shape: 'go-service', label: 'orders-service', subtitle: 'Go · gRPC + REST' },
        { key: 'billing', shape: 'java-service', label: 'billing-service', subtitle: 'Java · Spring Boot' },
        { key: 'ordersDb', shape: 'database', label: 'orders', subtitle: 'PostgreSQL' },
        { key: 'billingDb', shape: 'database', label: 'billing', subtitle: 'Oracle' },
        { key: 'topic', shape: 'kafka-topic', label: 'order.created' },
        { key: 'cache', shape: 'cache', label: 'session cache' },
      ],
      links: [
        { from: 'client', to: 'gateway', label: 'HTTPS', flow: true },
        { from: 'gateway', to: 'orders', label: 'POST /orders', flow: true },
        { from: 'gateway', to: 'cache' },
        { from: 'orders', to: 'ordersDb', label: 'SQL' },
        { from: 'orders', to: 'topic', label: 'publish', flow: true },
        { from: 'topic', to: 'billing', label: 'consume', flow: true },
        { from: 'billing', to: 'billingDb', label: 'JDBC' },
      ],
    },
  },
  {
    id: 'saga',
    label: 'Saga (orchestrated)',
    description: 'An orchestrator runs local transactions in order and compensates on failure.',
    blueprint: {
      nodes: [
        { key: 'start', shape: 'terminator', label: 'Place order' },
        { key: 'orchestrator', shape: 'saga-orchestrator', label: 'Order saga' },
        { key: 'reserve', shape: 'saga-step', label: 'Reserve stock', subtitle: 'compensate: release' },
        { key: 'charge', shape: 'saga-step', label: 'Charge card', subtitle: 'compensate: refund' },
        { key: 'ship', shape: 'saga-step', label: 'Ship order', subtitle: 'compensate: cancel' },
        { key: 'ok', shape: 'event', label: 'OrderCompleted' },
        { key: 'failed', shape: 'event', label: 'OrderRejected' },
      ],
      links: [
        { from: 'start', to: 'orchestrator', flow: true },
        { from: 'orchestrator', to: 'reserve', label: '1', flow: true },
        { from: 'orchestrator', to: 'charge', label: '2', flow: true },
        { from: 'orchestrator', to: 'ship', label: '3', flow: true },
        { from: 'ship', to: 'ok', label: 'success' },
        { from: 'charge', to: 'failed', label: 'failure → compensate', dashed: true },
      ],
    },
  },
  {
    id: 'camel',
    label: 'Apache Camel integration',
    description: 'A Camel route from a SOAP endpoint through a transformation to Kafka and a database.',
    blueprint: {
      nodes: [
        { key: 'boundary', shape: 'boundary', label: 'integration-service (Camel)' },
        { key: 'soap', shape: 'soap-endpoint', label: 'CustomerService', subtitle: 'WSDL · cxf:', parent: 'boundary' },
        { key: 'route', shape: 'camel-route', label: 'customer-sync', subtitle: 'from cxf → to kafka', parent: 'boundary' },
        { key: 'transform', shape: 'process', label: 'XSLT transform', parent: 'boundary' },
        { key: 'topic', shape: 'kafka-topic', label: 'customer.updated' },
        { key: 'db', shape: 'database', label: 'audit log', subtitle: 'jdbc:' },
        { key: 'legacy', shape: 'external', label: 'Legacy CRM' },
      ],
      links: [
        { from: 'legacy', to: 'soap', label: 'SOAP 1.1', flow: true },
        { from: 'soap', to: 'route', flow: true },
        { from: 'route', to: 'transform', flow: true },
        { from: 'transform', to: 'topic', label: 'to("kafka:…")', flow: true },
        { from: 'route', to: 'db', label: 'wireTap', dashed: true },
      ],
    },
  },
  {
    id: 'protocol-flow',
    label: 'REST, SOAP, Kafka & database flow',
    description: 'One request through REST, a SOAP back end, an event and the data stores.',
    blueprint: {
      nodes: [
        { key: 'rest', shape: 'rest-endpoint', label: 'POST /payments', subtitle: 'REST' },
        { key: 'api', shape: 'java-service', label: 'payments-api', subtitle: 'Java · JAX-RS' },
        { key: 'soap', shape: 'soap-endpoint', label: 'BankGateway', subtitle: 'WS-Security' },
        { key: 'topic', shape: 'kafka-topic', label: 'payment.settled' },
        { key: 'worker', shape: 'go-service', label: 'ledger-worker', subtitle: 'Go' },
        { key: 'db', shape: 'database', label: 'ledger', subtitle: 'PostgreSQL' },
      ],
      links: [
        { from: 'rest', to: 'api', flow: true },
        { from: 'api', to: 'soap', label: 'SOAP', flow: true },
        { from: 'api', to: 'topic', label: 'event', flow: true },
        { from: 'topic', to: 'worker', flow: true },
        { from: 'worker', to: 'db', label: 'INSERT' },
      ],
    },
  },
  {
    id: 'osgi',
    label: 'OSGi plug-in bundles',
    description: 'Bundles, the services they register and the packages they import.',
    blueprint: {
      nodes: [
        { key: 'framework', shape: 'boundary', label: 'Equinox framework' },
        { key: 'core', shape: 'osgi-bundle', label: 'com.acme.core', subtitle: 'exports com.acme.api', parent: 'framework' },
        { key: 'ui', shape: 'osgi-bundle', label: 'com.acme.ui', subtitle: 'Require-Bundle: core', parent: 'framework' },
        { key: 'rest', shape: 'osgi-bundle', label: 'com.acme.rest', subtitle: 'Import-Package: com.acme.api', parent: 'framework' },
        { key: 'service', shape: 'uml-interface', label: 'OrderService' },
      ],
      links: [
        { from: 'ui', to: 'core', label: 'requires' },
        { from: 'rest', to: 'core', label: 'imports' },
        { from: 'core', to: 'service', label: 'registers', dashed: true },
      ],
    },
  },
  {
    id: 'uml',
    label: 'UML classes',
    description: 'A small domain model: an interface, its implementation and an entity.',
    blueprint: {
      nodes: [
        { key: 'repo', shape: 'uml-interface', label: 'OrderRepository' },
        { key: 'impl', shape: 'uml-class', label: 'JpaOrderRepository' },
        { key: 'order', shape: 'uml-class', label: 'Order' },
      ],
      links: [
        { from: 'impl', to: 'repo', label: 'implements', dashed: true },
        { from: 'impl', to: 'order', label: 'persists' },
      ],
    },
  },
]
