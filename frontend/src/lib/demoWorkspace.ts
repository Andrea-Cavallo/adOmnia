import type { Collection, Environment, EnvVariable } from '@/lib/types'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'

interface WorkspaceV1 {
  format: string
  version: string
  exportedAt: string
  collections: Collection[]
  environments: {
    id: string
    name: string
    vars: EnvVariable[]
  }[]
  activeEnvId: string
}

const FORGE_CORE_WORKSPACE: WorkspaceV1 = {
  format: 'adomnia-workspace',
  version: '1.0',
  exportedAt: '2026-05-13T00:00:00.000Z',
  collections: [
    {
      id: 'col-forgecore',
      name: 'ForgeCore Gateway API',
      color: '#6366f1',
      children: [
        {"id":"f1","name":"Health","type":"folder","children":[
          {"id":"r1","name":"GET healthz","type":"request","method":"GET","url":"{{base_url}}/healthz","params":[],"headers":[{"id":"h1","key":"X-Request-ID","value":"{{request_id}}","enabled":true}],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}},
          {"id":"r2","name":"GET readyz","type":"request","method":"GET","url":"{{base_url}}/readyz","params":[],"headers":[{"id":"h1","key":"X-Request-ID","value":"{{request_id}}","enabled":true}],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}}
        ]},
        {"id":"f2","name":"Auth","type":"folder","children":[
          {"id":"r3","name":"POST login","type":"request","method":"POST","url":"{{base_url}}/v1/auth/login","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true},{"id":"h2","key":"X-Tenant-ID","value":"{{tenant_id}}","enabled":true},{"id":"h3","key":"X-Request-ID","value":"{{request_id}}","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"email\":\"{{email}}\",\"password\":\"{{password}}\",\"device_id\":\"adomnia\",\"user_agent\":\"adOmnia\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}},
          {"id":"r4","name":"POST register","type":"request","method":"POST","url":"{{base_url}}/v1/auth/register","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true},{"id":"h2","key":"X-Tenant-ID","value":"{{tenant_id}}","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"email\":\"{{email}}\",\"password\":\"{{password}}\",\"first_name\":\"Demo\",\"last_name\":\"User\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}},
          {"id":"r5","name":"POST refresh","type":"request","method":"POST","url":"{{base_url}}/v1/auth/refresh","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true},{"id":"h2","key":"X-Tenant-ID","value":"{{tenant_id}}","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"refresh_token\":\"{{refresh_token}}\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}}
        ]},
        {"id":"f3","name":"Payments","type":"folder","children":[
          {"id":"r6","name":"POST create payment","type":"request","method":"POST","url":"{{base_url}}/v1/payments","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true},{"id":"h2","key":"Idempotency-Key","value":"{{idempotency_key}}","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"amount\":4990,\"currency\":\"EUR\",\"customer_id\":\"{{customer_id}}\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r7","name":"GET list payments","type":"request","method":"GET","url":"{{base_url}}/v1/payments?limit=20","params":[],"headers":[{"id":"h1","key":"X-Request-ID","value":"{{request_id}}","enabled":true}],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r8","name":"POST refund","type":"request","method":"POST","url":"{{base_url}}/v1/payments/{{payment_id}}/refund","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"amount\":1000}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f4","name":"Subscriptions","type":"folder","children":[
          {"id":"r9","name":"POST create subscription","type":"request","method":"POST","url":"{{base_url}}/v1/subscriptions","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true},{"id":"h2","key":"Idempotency-Key","value":"{{idempotency_key}}","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"plan_id\":\"{{plan_id}}\",\"customer_id\":\"{{customer_id}}\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r10","name":"DELETE cancel subscription","type":"request","method":"DELETE","url":"{{base_url}}/v1/subscriptions/{{subscription_id}}","params":[],"headers":[],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f5","name":"Config","type":"folder","children":[
          {"id":"r11","name":"GET config","type":"request","method":"GET","url":"{{base_url}}/v1/config/{{config_key}}","params":[],"headers":[],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r12","name":"PUT config","type":"request","method":"PUT","url":"{{base_url}}/v1/config/{{config_key}}","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"value\":\"dark\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f6","name":"Permissions","type":"folder","children":[
          {"id":"r13","name":"POST permission check","type":"request","method":"POST","url":"{{base_url}}/v1/permissions/check","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"resource_type\":\"project\",\"resource_id\":null,\"action\":\"read\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r14","name":"POST grant permission","type":"request","method":"POST","url":"{{base_url}}/v1/permissions/grant","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"user_id\":\"{{user_id}}\",\"resource_type\":\"project\",\"resource_id\":null,\"action\":\"read\"}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f7","name":"Webhooks","type":"folder","children":[
          {"id":"r15","name":"POST register endpoint","type":"request","method":"POST","url":"{{base_url}}/v1/webhooks/endpoints","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"url\":\"{{webhook_url}}\",\"secret\":\"{{webhook_secret}}\",\"events\":[\"payment.succeeded.v1\"]}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r16","name":"POST deliver event","type":"request","method":"POST","url":"{{base_url}}/v1/webhooks/deliver","params":[],"headers":[{"id":"h1","key":"Content-Type","value":"application/json","enabled":true}],"bodies":[{"id":"b1","type":"raw","raw":"{\"event_type\":\"payment.succeeded.v1\",\"payload\":{\"payment_id\":\"{{payment_id}}\",\"amount\":4990}}","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f8","name":"Admin","type":"folder","children":[
          {"id":"r17","name":"GET tenants","type":"request","method":"GET","url":"{{base_url}}/v1/admin/tenants?limit=20","params":[],"headers":[],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}},
          {"id":"r18","name":"GET stats","type":"request","method":"GET","url":"{{base_url}}/v1/admin/stats","params":[],"headers":[],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"bearer","token":"{{access_token}}","username":"","password":""}}
        ]},
        {"id":"f9","name":"Negative Tests","type":"folder","children":[
          {"id":"r19","name":"GET protected without token","type":"request","method":"GET","url":"{{base_url}}/v1/payments","params":[],"headers":[{"id":"h1","key":"X-Request-ID","value":"{{request_id}}","enabled":true}],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}},
          {"id":"r20","name":"OPTIONS CORS preflight","type":"request","method":"OPTIONS","url":"{{base_url}}/v1/auth/login","params":[],"headers":[{"id":"h1","key":"Origin","value":"{{allowed_origin}}","enabled":true},{"id":"h2","key":"Access-Control-Request-Method","value":"POST","enabled":true}],"bodies":[{"id":"b1","type":"none","raw":"","lang":"json","form":[],"name":"Body 1"}],"activeBodyIdx":0,"auth":{"type":"none","token":"","username":"","password":""}}
        ]}
      ],
    } as any,
    {
      id: 'col-soap',
      name: 'SOAP / Enterprise Services',
      color: '#f97316',
      children: [
        {id:'fs1',name:'Banking WS',type:'folder',children:[
          {id:'rs1',name:'GetAccountBalance',type:'request',method:'SOAP',url:'{{soap_url}}/BankingService.svc',params:[],
            headers:[
              {id:'sh11',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh12',key:'SOAPAction',value:'"urn:BankingService/GetAccountBalance"',enabled:true},
            ],
            bodies:[{id:'sb11',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bank="http://banking.example.com/ws/v1">
  <soapenv:Header>
    <bank:Auth><bank:Token>{{soap_token}}</bank:Token></bank:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <bank:GetAccountBalanceRequest>
      <bank:AccountNumber>{{account_number}}</bank:AccountNumber>
      <bank:Currency>EUR</bank:Currency>
    </bank:GetAccountBalanceRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rs2',name:'FundTransfer',type:'request',method:'SOAP',url:'{{soap_url}}/BankingService.svc',params:[],
            headers:[
              {id:'sh21',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh22',key:'SOAPAction',value:'"urn:BankingService/FundTransfer"',enabled:true},
            ],
            bodies:[{id:'sb21',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bank="http://banking.example.com/ws/v1">
  <soapenv:Header>
    <bank:Auth><bank:Token>{{soap_token}}</bank:Token></bank:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <bank:FundTransferRequest>
      <bank:FromAccount>{{account_number}}</bank:FromAccount>
      <bank:ToAccount>IT60X0542811101000000654321</bank:ToAccount>
      <bank:Amount>250.00</bank:Amount>
      <bank:Currency>EUR</bank:Currency>
      <bank:Description>Demo transfer adOmnia</bank:Description>
    </bank:FundTransferRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rs3',name:'GetTransactionHistory',type:'request',method:'SOAP',url:'{{soap_url}}/BankingService.svc',params:[],
            headers:[
              {id:'sh31',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh32',key:'SOAPAction',value:'"urn:BankingService/GetTransactionHistory"',enabled:true},
            ],
            bodies:[{id:'sb31',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bank="http://banking.example.com/ws/v1">
  <soapenv:Header>
    <bank:Auth><bank:Token>{{soap_token}}</bank:Token></bank:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <bank:GetTransactionHistoryRequest>
      <bank:AccountNumber>{{account_number}}</bank:AccountNumber>
      <bank:FromDate>2026-01-01</bank:FromDate>
      <bank:ToDate>2026-05-31</bank:ToDate>
      <bank:MaxResults>50</bank:MaxResults>
    </bank:GetTransactionHistoryRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
        {id:'fs2',name:'Insurance WS',type:'folder',children:[
          {id:'rs4',name:'GetPolicyStatus',type:'request',method:'SOAP',url:'{{soap_url}}/InsuranceService.svc',params:[],
            headers:[
              {id:'sh41',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh42',key:'SOAPAction',value:'"urn:InsuranceService/GetPolicyStatus"',enabled:true},
            ],
            bodies:[{id:'sb41',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ins="http://insurance.example.com/ws/v2">
  <soapenv:Header>
    <ins:Auth><ins:Token>{{soap_token}}</ins:Token></ins:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <ins:GetPolicyStatusRequest>
      <ins:PolicyNumber>{{policy_number}}</ins:PolicyNumber>
      <ins:HolderId>{{user_id}}</ins:HolderId>
    </ins:GetPolicyStatusRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rs5',name:'SubmitClaim',type:'request',method:'SOAP',url:'{{soap_url}}/InsuranceService.svc',params:[],
            headers:[
              {id:'sh51',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh52',key:'SOAPAction',value:'"urn:InsuranceService/SubmitClaim"',enabled:true},
            ],
            bodies:[{id:'sb51',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ins="http://insurance.example.com/ws/v2">
  <soapenv:Header>
    <ins:Auth><ins:Token>{{soap_token}}</ins:Token></ins:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <ins:SubmitClaimRequest>
      <ins:PolicyNumber>{{policy_number}}</ins:PolicyNumber>
      <ins:ClaimType>ACCIDENT</ins:ClaimType>
      <ins:Amount>1500.00</ins:Amount>
      <ins:Description>Vehicle damage on 2026-05-10</ins:Description>
      <ins:IncidentDate>2026-05-10</ins:IncidentDate>
    </ins:SubmitClaimRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
        {id:'fs3',name:'Government WS',type:'folder',children:[
          {id:'rs6',name:'VerifyIdentity',type:'request',method:'SOAP',url:'{{soap_url}}/IdentityService.svc',params:[],
            headers:[
              {id:'sh61',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh62',key:'SOAPAction',value:'"urn:IdentityService/VerifyIdentity"',enabled:true},
            ],
            bodies:[{id:'sb61',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:gov="http://gov.example.it/ws/v1">
  <soapenv:Header>
    <gov:Auth><gov:ApiKey>{{soap_token}}</gov:ApiKey></gov:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <gov:VerifyIdentityRequest>
      <gov:FiscalCode>RSSMRA80A01H501U</gov:FiscalCode>
      <gov:FirstName>Mario</gov:FirstName>
      <gov:LastName>Rossi</gov:LastName>
      <gov:DateOfBirth>1980-01-01</gov:DateOfBirth>
    </gov:VerifyIdentityRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rs7',name:'CheckTaxStatus',type:'request',method:'SOAP',url:'{{soap_url}}/TaxService.svc',params:[],
            headers:[
              {id:'sh71',key:'Content-Type',value:'text/xml; charset=utf-8',enabled:true},
              {id:'sh72',key:'SOAPAction',value:'"urn:TaxService/CheckTaxStatus"',enabled:true},
            ],
            bodies:[{id:'sb71',name:'SOAP Envelope',type:'raw',lang:'xml',form:[],raw:
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tax="http://agenzia.entrate.gov.it/ws/v1">
  <soapenv:Header>
    <tax:Auth><tax:ApiKey>{{soap_token}}</tax:ApiKey></tax:Auth>
  </soapenv:Header>
  <soapenv:Body>
    <tax:CheckTaxStatusRequest>
      <tax:FiscalCode>RSSMRA80A01H501U</tax:FiscalCode>
      <tax:Year>2025</tax:Year>
    </tax:CheckTaxStatusRequest>
  </soapenv:Body>
</soapenv:Envelope>`}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
      ],
    } as any,
    {
      id: 'col-pubsub',
      name: 'Pub/Sub Event Bus',
      color: '#a855f7',
      children: [
        {id:'fp1',name:'Kafka REST Proxy',type:'folder',children:[
          {id:'rp1',name:'Publish payment.completed',type:'request',method:'POST',
            url:'{{kafka_rest_url}}/topics/payment.events',params:[],
            headers:[
              {id:'ph11',key:'Content-Type',value:'application/vnd.kafka.json.v2+json',enabled:true},
              {id:'ph12',key:'Accept',value:'application/vnd.kafka.v2+json',enabled:true},
            ],
            bodies:[{id:'pb11',name:'Kafka Record',type:'raw',lang:'json',form:[],
              raw:'{"records":[{"key":"{{payment_id}}","value":{"event_type":"payment.completed","version":"1","ts":"2026-05-15T10:00:00Z","payload":{"payment_id":"{{payment_id}}","amount":4990,"currency":"EUR","customer_id":"{{customer_id}}","status":"completed"}}}]}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rp2',name:'Publish user.registered',type:'request',method:'POST',
            url:'{{kafka_rest_url}}/topics/user.events',params:[],
            headers:[
              {id:'ph21',key:'Content-Type',value:'application/vnd.kafka.json.v2+json',enabled:true},
              {id:'ph22',key:'Accept',value:'application/vnd.kafka.v2+json',enabled:true},
            ],
            bodies:[{id:'pb21',name:'Kafka Record',type:'raw',lang:'json',form:[],
              raw:'{"records":[{"key":"{{user_id}}","value":{"event_type":"user.registered","version":"1","ts":"2026-05-15T10:00:00Z","payload":{"user_id":"{{user_id}}","email":"{{email}}","tenant_id":"{{tenant_id}}"}}}]}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rp3',name:'GET List Topics',type:'request',method:'GET',
            url:'{{kafka_rest_url}}/topics',params:[],
            headers:[{id:'ph31',key:'Accept',value:'application/vnd.kafka.v2+json',enabled:true}],
            bodies:[{id:'pb31',name:'Body 1',type:'none',raw:'',lang:'json',form:[]}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rp4',name:'GET Consumer Group Offsets',type:'request',method:'GET',
            url:'{{kafka_rest_url}}/consumers/{{consumer_group}}/instances/{{consumer_group}}-1/offsets',params:[],
            headers:[{id:'ph41',key:'Accept',value:'application/vnd.kafka.v2+json',enabled:true}],
            bodies:[{id:'pb41',name:'Body 1',type:'none',raw:'',lang:'json',form:[]}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
        {id:'fp2',name:'Event Store',type:'folder',children:[
          {id:'rp5',name:'POST order.created',type:'request',method:'POST',
            url:'{{kafka_rest_url}}/topics/order.events',params:[],
            headers:[
              {id:'ph51',key:'Content-Type',value:'application/vnd.kafka.json.v2+json',enabled:true},
            ],
            bodies:[{id:'pb51',name:'Kafka Record',type:'raw',lang:'json',form:[],
              raw:'{"records":[{"key":"ord-001","value":{"event_type":"order.created","version":"1","ts":"2026-05-15T10:00:00Z","payload":{"order_id":"ord-001","customer_id":"{{customer_id}}","items":[{"sku":"ITEM-001","qty":2,"price":1995}],"total":3990,"currency":"EUR"}}}]}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rp6',name:'POST notification.push',type:'request',method:'POST',
            url:'{{kafka_rest_url}}/topics/notification.events',params:[],
            headers:[
              {id:'ph61',key:'Content-Type',value:'application/vnd.kafka.json.v2+json',enabled:true},
            ],
            bodies:[{id:'pb61',name:'Kafka Record',type:'raw',lang:'json',form:[],
              raw:'{"records":[{"key":"{{user_id}}","value":{"event_type":"notification.push","version":"1","ts":"2026-05-15T10:00:00Z","payload":{"user_id":"{{user_id}}","title":"Payment confirmed","body":"Your payment of EUR 49.90 was successful","channel":"push"}}}]}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
      ],
    } as any,
    {
      id: 'col-ws',
      name: 'WebSocket Playground',
      color: '#14b8a6',
      children: [
        {id:'fw1',name:'Real-time Chat',type:'folder',children:[
          {id:'rw1',name:'Chat Room Connect',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/chat/{{room_id}}',params:[],
            headers:[{id:'wh11',key:'X-Auth-Token',value:'{{access_token}}',enabled:true}],
            bodies:[{id:'wb11',name:'Join Message',type:'raw',lang:'json',form:[],
              raw:'{"type":"join","room_id":"{{room_id}}","user_id":"{{user_id}}","display_name":"Demo User"}'}],
            activeBodyIdx:0,auth:{type:'bearer',token:'{{access_token}}',username:'',password:''}},
          {id:'rw2',name:'Send Chat Message',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/chat/{{room_id}}',params:[],
            headers:[{id:'wh21',key:'X-Auth-Token',value:'{{access_token}}',enabled:true}],
            bodies:[{id:'wb21',name:'Chat Message',type:'raw',lang:'json',form:[],
              raw:'{"type":"message","room_id":"{{room_id}}","text":"Hello from adOmnia!","ts":"2026-05-15T10:00:00Z"}'}],
            activeBodyIdx:0,auth:{type:'bearer',token:'{{access_token}}',username:'',password:''}},
        ]},
        {id:'fw2',name:'Market Data',type:'folder',children:[
          {id:'rw3',name:'EUR/USD Price Feed',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/market/prices',params:[],
            headers:[],
            bodies:[{id:'wb31',name:'Subscribe',type:'raw',lang:'json',form:[],
              raw:'{"action":"subscribe","channels":["EURUSD","GBPUSD","USDJPY"],"interval_ms":1000}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
          {id:'rw4',name:'Order Book Stream',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/market/orderbook',params:[],
            headers:[],
            bodies:[{id:'wb41',name:'Subscribe',type:'raw',lang:'json',form:[],
              raw:'{"action":"subscribe","symbol":"EURUSD","depth":10}'}],
            activeBodyIdx:0,auth:{type:'none',token:'',username:'',password:''}},
        ]},
        {id:'fw3',name:'Notifications',type:'folder',children:[
          {id:'rw5',name:'User Notifications',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/notifications/{{user_id}}',params:[],
            headers:[{id:'wh51',key:'X-Auth-Token',value:'{{access_token}}',enabled:true}],
            bodies:[{id:'wb51',name:'Auth Frame',type:'raw',lang:'json',form:[],
              raw:'{"type":"auth","token":"{{access_token}}"}'}],
            activeBodyIdx:0,auth:{type:'bearer',token:'{{access_token}}',username:'',password:''}},
          {id:'rw6',name:'System Alerts',type:'request',method:'WS',
            url:'ws://{{ws_host}}/ws/alerts/system',params:[],
            headers:[{id:'wh61',key:'X-Auth-Token',value:'{{access_token}}',enabled:true}],
            bodies:[{id:'wb61',name:'Subscribe',type:'raw',lang:'json',form:[],
              raw:'{"type":"subscribe","topics":["system.health","deployment.events","error.rate"]}'}],
            activeBodyIdx:0,auth:{type:'bearer',token:'{{access_token}}',username:'',password:''}},
        ]},
      ],
    } as any,
  ],
  environments: [
    {
      id: 'forgecore-local',
      name: 'ForgeCore Local',
      vars: [
        {id:'v1',key:'base_url',value:'http://localhost:8080',enabled:true},
        {id:'v2',key:'tenant_id',value:'00000000-0000-0000-0000-000000000001',enabled:true},
        {id:'v3',key:'user_id',value:'00000000-0000-0000-0000-000000000002',enabled:true},
        {id:'v4',key:'admin_user_id',value:'00000000-0000-0000-0000-000000000003',enabled:true},
        {id:'v5',key:'email',value:'demo@forgecore.local',enabled:true},
        {id:'v6',key:'password',value:'ChangeMe123!',enabled:true},
        {id:'v7',key:'access_token',value:'',enabled:true},
        {id:'v8',key:'refresh_token',value:'',enabled:true},
        {id:'v9',key:'request_id',value:'req-local',enabled:true},
        {id:'v10',key:'idempotency_key',value:'idem-local',enabled:true},
        {id:'v11',key:'payment_id',value:'00000000-0000-0000-0000-000000000010',enabled:true},
        {id:'v12',key:'customer_id',value:'cus_demo_001',enabled:true},
        {id:'v13',key:'plan_id',value:'00000000-0000-0000-0000-000000000020',enabled:true},
        {id:'v14',key:'subscription_id',value:'00000000-0000-0000-0000-000000000021',enabled:true},
        {id:'v15',key:'permission_id',value:'00000000-0000-0000-0000-000000000030',enabled:true},
        {id:'v16',key:'file_id',value:'00000000-0000-0000-0000-000000000040',enabled:true},
        {id:'v17',key:'config_key',value:'frontend.theme',enabled:true},
        {id:'v18',key:'webhook_secret',value:'whsec_demo_secret',enabled:true},
        {id:'v19',key:'webhook_url',value:'https://webhooks.your-domain.com/forgecore',enabled:true},
        {id:'v20',key:'allowed_origin',value:'http://localhost:5173',enabled:true},
        {id:'v21',key:'blocked_origin',value:'https://malicious.your-domain.com',enabled:true},
        {id:'v22',key:'soap_url',value:'http://localhost:9000/ws',enabled:true},
        {id:'v23',key:'soap_token',value:'',enabled:true},
        {id:'v24',key:'account_number',value:'IT60X0542811101000000123456',enabled:true},
        {id:'v25',key:'policy_number',value:'POL-2026-001234',enabled:true},
        {id:'v26',key:'ws_host',value:'localhost:8080',enabled:true},
        {id:'v27',key:'room_id',value:'demo-room-001',enabled:true},
        {id:'v28',key:'kafka_rest_url',value:'http://localhost:8082',enabled:true},
        {id:'v29',key:'consumer_group',value:'adomnia-demo',enabled:true},
      ],
    },
    {
      id: 'forgecore-mock',
      name: 'ForgeCore Mock',
      vars: [
        {id:'v1',key:'base_url',value:'http://localhost:9090',enabled:true},
        {id:'v2',key:'tenant_id',value:'00000000-0000-0000-0000-000000000001',enabled:true},
        {id:'v3',key:'user_id',value:'00000000-0000-0000-0000-000000000002',enabled:true},
        {id:'v4',key:'admin_user_id',value:'00000000-0000-0000-0000-000000000003',enabled:true},
        {id:'v5',key:'email',value:'demo@forgecore.local',enabled:true},
        {id:'v6',key:'password',value:'ChangeMe123!',enabled:true},
        {id:'v7',key:'access_token',value:'',enabled:true},
        {id:'v8',key:'refresh_token',value:'',enabled:true},
        {id:'v9',key:'request_id',value:'req-mock',enabled:true},
        {id:'v10',key:'idempotency_key',value:'idem-mock',enabled:true},
        {id:'v11',key:'payment_id',value:'00000000-0000-0000-0000-000000000010',enabled:true},
        {id:'v12',key:'customer_id',value:'cus_demo_001',enabled:true},
        {id:'v13',key:'plan_id',value:'00000000-0000-0000-0000-000000000020',enabled:true},
        {id:'v14',key:'subscription_id',value:'00000000-0000-0000-0000-000000000021',enabled:true},
        {id:'v15',key:'permission_id',value:'00000000-0000-0000-0000-000000000030',enabled:true},
        {id:'v16',key:'file_id',value:'00000000-0000-0000-0000-000000000040',enabled:true},
        {id:'v17',key:'config_key',value:'frontend.theme',enabled:true},
        {id:'v18',key:'webhook_secret',value:'whsec_demo_secret',enabled:true},
        {id:'v19',key:'webhook_url',value:'https://webhooks.your-domain.com/forgecore',enabled:true},
        {id:'v20',key:'allowed_origin',value:'http://localhost:5173',enabled:true},
        {id:'v21',key:'blocked_origin',value:'https://malicious.your-domain.com',enabled:true},
        {id:'v22',key:'soap_url',value:'http://localhost:9090/ws',enabled:true},
        {id:'v23',key:'soap_token',value:'mock-soap-token',enabled:true},
        {id:'v24',key:'account_number',value:'IT60X0542811101000000123456',enabled:true},
        {id:'v25',key:'policy_number',value:'POL-2026-001234',enabled:true},
        {id:'v26',key:'ws_host',value:'localhost:9090',enabled:true},
        {id:'v27',key:'room_id',value:'demo-room-001',enabled:true},
        {id:'v28',key:'kafka_rest_url',value:'http://localhost:8082',enabled:true},
        {id:'v29',key:'consumer_group',value:'adomnia-demo',enabled:true},
      ],
    },
  ],
  activeEnvId: 'forgecore-local',
}

function jsonBody(id: string, name: string, data: unknown) {
  return {
    id,
    name,
    type: 'raw' as const,
    raw: JSON.stringify(data, null, 2),
    lang: 'json' as const,
    form: [],
  }
}

function lineItems(count: number, prefix: string) {
  return Array.from({ length: count }, (_, idx) => ({
    sku: `${prefix}-${String(idx + 1).padStart(4, '0')}`,
    name: `Integration test item ${idx + 1}`,
    quantity: (idx % 5) + 1,
    unitPrice: 1299 + idx * 37,
    taxCode: idx % 3 === 0 ? 'VAT22' : 'VAT10',
    costCenter: `CC-${100 + (idx % 8)}`,
    metadata: {
      source: 'postman-demo',
      batchIndex: idx,
      notes: 'Large body sample for editor stress and scroll testing',
    },
  }))
}

function auditTrail(count: number, actor = '{{operator_id}}') {
  return Array.from({ length: count }, (_, idx) => ({
    at: `2026-05-${String((idx % 22) + 1).padStart(2, '0')}T${String(idx % 24).padStart(2, '0')}:15:00Z`,
    actor,
    action: idx % 2 === 0 ? 'validated' : 'enriched',
    field: ['status', 'riskScore', 'shippingAddress', 'paymentMethod'][idx % 4],
    previous: idx % 2 === 0 ? 'pending' : 'draft',
    next: idx % 2 === 0 ? 'approved' : 'reviewed',
    correlationId: `corr-demo-${idx + 1}`,
  }))
}

const POSTMAN_DEMO_COLLECTION: Collection = {
  id: 'col-adomnia-postman-demo',
  name: 'adOmnia Postman Demo Collection',
  color: '#34d399',
  children: [
    {
      id: 'demo-folder-commerce',
      name: 'Commerce Platform',
      type: 'folder',
      children: [
        {
          id: 'demo-req-payment-batch',
          name: 'POST create payment batch',
          type: 'request',
          method: 'POST',
          url: '{{base_url}}/v1/tenants/{{tenant_id}}/payment-batches',
          params: [
            { id: 'p1', key: 'dry_run', value: '{{dry_run}}', enabled: true },
            { id: 'p2', key: 'include_validation_report', value: 'true', enabled: true },
          ],
          headers: [
            { id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true },
            { id: 'h2', key: 'Authorization', value: 'Bearer {{access_token}}', enabled: true },
            { id: 'h3', key: 'Idempotency-Key', value: '{{idempotency_key}}', enabled: true },
            { id: 'h4', key: 'X-Request-ID', value: '{{request_id}}', enabled: true },
          ],
          bodies: [
            jsonBody('b1', 'Card settlement - 40 lines', {
              batchReference: '{{batch_reference}}',
              currency: 'EUR',
              settlementDate: '2026-05-22',
              merchant: {
                id: '{{merchant_id}}',
                legalName: 'Demo Retail Italia S.p.A.',
                mcc: '5734',
              },
              payments: lineItems(40, 'PAY').map((item, idx) => ({
                paymentId: `pay_demo_${idx + 1}`,
                customerId: `cus_demo_${String(idx + 1).padStart(3, '0')}`,
                amount: item.unitPrice * item.quantity,
                currency: 'EUR',
                capture: true,
                statementDescriptor: `ADOMNIA DEMO ${idx + 1}`,
                lineItem: item,
              })),
              audit: auditTrail(18),
            }),
            jsonBody('b2', 'SEPA transfer batch', {
              batchReference: '{{batch_reference}}-sepa',
              scheme: 'SEPA_CREDIT_TRANSFER',
              debtorAccount: '{{iban_primary}}',
              requestedExecutionDate: '2026-05-23',
              transfers: lineItems(34, 'INV').map((item, idx) => ({
                creditorName: `Supplier ${idx + 1} S.r.l.`,
                creditorIban: `IT60X0542811101000000${String(650000 + idx).padStart(6, '0')}`,
                remittanceInformation: `Invoice ${item.sku}`,
                amount: item.unitPrice * item.quantity,
                endToEndId: `E2E-${item.sku}`,
              })),
              audit: auditTrail(14),
            }),
            jsonBody('b3', 'Marketplace payout preview', {
              batchReference: '{{batch_reference}}-marketplace',
              marketplace: {
                id: '{{merchant_id}}',
                country: 'IT',
                payoutModel: 'split-settlement',
              },
              sellers: lineItems(38, 'SELLER').map((item, idx) => ({
                sellerId: `seller_${String(idx + 1).padStart(3, '0')}`,
                grossAmount: item.unitPrice * item.quantity,
                platformFee: Math.round(item.unitPrice * item.quantity * 0.085),
                reservePercent: idx % 4 === 0 ? 12 : 5,
                descriptor: item.name,
              })),
              audit: auditTrail(16),
            }),
          ],
          activeBodyIdx: 0,
          auth: { type: 'bearer', token: '{{access_token}}', username: '', password: '' },
          timeout: 30000,
          followRedirects: true,
        },
        {
          id: 'demo-req-risk-profile',
          name: 'PUT customer risk profile',
          type: 'request',
          method: 'PUT',
          url: '{{base_url}}/v1/customers/{{customer_id}}/risk-profile',
          params: [],
          headers: [
            { id: 'h5', key: 'Content-Type', value: 'application/json', enabled: true },
            { id: 'h6', key: 'Authorization', value: 'Bearer {{access_token}}', enabled: true },
            { id: 'h7', key: 'X-Tenant-ID', value: '{{tenant_id}}', enabled: true },
          ],
          bodies: [
            jsonBody('b4', 'KYC refresh with documents', {
              customerId: '{{customer_id}}',
              profileVersion: 7,
              riskTier: 'medium',
              kyc: {
                legalName: 'Mario Rossi',
                fiscalCode: 'RSSMRA80A01H501U',
                documentChecks: lineItems(24, 'DOC').map((item, idx) => ({
                  documentId: item.sku,
                  type: idx % 2 === 0 ? 'identity_card' : 'proof_of_address',
                  status: idx % 5 === 0 ? 'manual_review' : 'verified',
                  extractedFields: item,
                })),
              },
              audit: auditTrail(26),
            }),
            jsonBody('b5', 'High-value merchant review', {
              customerId: '{{customer_id}}',
              profileVersion: 8,
              riskTier: 'high',
              merchantActivity: {
                monthlyVolume: 24500000,
                averageTicket: 18900,
                chargebackRatio: 0.0068,
                countries: ['IT', 'DE', 'FR', 'ES', 'NL'],
                counterparties: lineItems(36, 'CP'),
              },
              audit: auditTrail(22),
            }),
            jsonBody('b6', 'Low-risk consumer update', {
              customerId: '{{customer_id}}',
              profileVersion: 9,
              riskTier: 'low',
              preferences: {
                channels: ['email', 'push', 'sms'],
                consents: lineItems(30, 'CONSENT').map((item, idx) => ({
                  code: item.sku,
                  granted: idx % 4 !== 0,
                  evidence: item.metadata,
                })),
              },
              audit: auditTrail(20),
            }),
          ],
          activeBodyIdx: 0,
          auth: { type: 'bearer', token: '{{access_token}}', username: '', password: '' },
          timeout: 30000,
          followRedirects: true,
        },
        {
          id: 'demo-req-event-ingest',
          name: 'POST bulk event ingest',
          type: 'request',
          method: 'POST',
          url: '{{base_url}}/v1/events/bulk',
          params: [
            { id: 'p3', key: 'partition_key', value: '{{tenant_id}}', enabled: true },
          ],
          headers: [
            { id: 'h8', key: 'Content-Type', value: 'application/json', enabled: true },
            { id: 'h9', key: 'Authorization', value: 'Bearer {{access_token}}', enabled: true },
            { id: 'h10', key: 'X-Source-System', value: 'adomnia-demo', enabled: true },
          ],
          bodies: [
            jsonBody('b7', 'Order lifecycle events', {
              stream: 'commerce.order.lifecycle',
              events: lineItems(45, 'ORD').map((item, idx) => ({
                id: `evt_order_${idx + 1}`,
                type: ['order.created', 'order.paid', 'order.shipped'][idx % 3],
                aggregateId: item.sku,
                occurredAt: `2026-05-22T10:${String(idx % 60).padStart(2, '0')}:00Z`,
                payload: item,
              })),
            }),
            jsonBody('b8', 'Security audit events', {
              stream: 'security.audit',
              events: auditTrail(52).map((entry, idx) => ({
                id: `evt_security_${idx + 1}`,
                severity: idx % 9 === 0 ? 'warning' : 'info',
                category: ['auth', 'vault', 'proxy', 'workspace'][idx % 4],
                payload: entry,
              })),
            }),
            jsonBody('b9', 'Webhook replay events', {
              stream: 'webhook.replay',
              replayId: '{{request_id}}',
              events: lineItems(42, 'WEBHOOK').map((item, idx) => ({
                id: `evt_webhook_${idx + 1}`,
                destination: '{{webhook_url}}',
                signatureHeader: 'X-Adomnia-Signature',
                payload: {
                  item,
                  retry: idx % 3,
                  deliveryWindowSeconds: 30,
                },
              })),
            }),
          ],
          activeBodyIdx: 0,
          auth: { type: 'bearer', token: '{{access_token}}', username: '', password: '' },
          timeout: 45000,
          followRedirects: true,
        },
        {
          id: 'demo-req-search',
          name: 'POST advanced product search',
          type: 'request',
          method: 'POST',
          url: '{{base_url}}/v1/search/products',
          params: [
            { id: 'p4', key: 'explain', value: 'true', enabled: true },
          ],
          headers: [
            { id: 'h11', key: 'Content-Type', value: 'application/json', enabled: true },
            { id: 'h12', key: 'Authorization', value: 'Bearer {{access_token}}', enabled: true },
          ],
          bodies: [
            jsonBody('b10', 'Faceted catalog search', {
              query: 'enterprise laptop docking station',
              locale: 'it-IT',
              pagination: { page: 1, size: 50 },
              filters: {
                categories: ['hardware', 'workstations', 'accessories'],
                price: { min: 5000, max: 250000, currency: 'EUR' },
                attributes: lineItems(32, 'ATTR'),
              },
              ranking: { strategy: 'hybrid', boostInStock: true, boostContractItems: true },
            }),
            jsonBody('b11', 'Procurement compliance search', {
              query: 'firewall appliance high availability',
              locale: 'en-US',
              buyer: { id: '{{operator_id}}', company: 'Demo Enterprise Group' },
              complianceRules: lineItems(36, 'RULE').map((item, idx) => ({
                ruleId: item.sku,
                required: idx % 2 === 0,
                evidence: item.metadata,
              })),
            }),
            jsonBody('b12', 'Legacy ERP enrichment search', {
              query: 'spare parts',
              locale: 'it-IT',
              erpContext: {
                system: 'SAP ECC demo',
                plant: 'IT01',
                purchasingOrg: 'P100',
                contracts: lineItems(40, 'CONTRACT'),
              },
              include: ['availability', 'substitutions', 'supplier_scores', 'historic_prices'],
            }),
          ],
          activeBodyIdx: 0,
          auth: { type: 'bearer', token: '{{access_token}}', username: '', password: '' },
          timeout: 30000,
          followRedirects: true,
        },
      ],
    },
  ],
}

const POSTMAN_DEMO_ENVIRONMENT: Environment = {
  id: 'env-adomnia-postman-demo',
  name: 'adOmnia Demo Environment',
  variables: [
    { id: 'dv1', key: 'base_url', value: 'http://localhost:8080', enabled: true },
    { id: 'dv2', key: 'tenant_id', value: 'tenant_demo_italia', enabled: true },
    { id: 'dv3', key: 'access_token', value: 'demo-token-replace-me', enabled: true, type: 'secret' },
    { id: 'dv4', key: 'request_id', value: 'req-demo-2026-05-22', enabled: true },
    { id: 'dv5', key: 'idempotency_key', value: 'idem-demo-001', enabled: true },
    { id: 'dv6', key: 'batch_reference', value: 'batch-2026-05-demo', enabled: true },
    { id: 'dv7', key: 'merchant_id', value: 'mrc_demo_001', enabled: true },
    { id: 'dv8', key: 'customer_id', value: 'cus_demo_001', enabled: true },
    { id: 'dv9', key: 'operator_id', value: 'ops_adomnia_demo', enabled: true },
    { id: 'dv10', key: 'dry_run', value: 'true', enabled: true },
    { id: 'dv11', key: 'iban_primary', value: 'IT60X0542811101000000123456', enabled: true },
    { id: 'dv12', key: 'webhook_url', value: 'https://webhooks.example.test/adomnia', enabled: true },
  ],
}

export function getForgeCoreCollections(): Collection[] {
  return FORGE_CORE_WORKSPACE.collections as Collection[]
}

export function getForgeCoreEnvironments(): Environment[] {
  return FORGE_CORE_WORKSPACE.environments.map(({ id, name, vars }) => ({
    id,
    name,
    variables: vars,
  }))
}

export function getForgeCoreActiveEnvId(): string {
  return FORGE_CORE_WORKSPACE.activeEnvId
}

function getDefaultPostmanDemoCollection(): Collection {
  return JSON.parse(JSON.stringify(POSTMAN_DEMO_COLLECTION)) as Collection
}

function getDefaultPostmanDemoEnvironment(): Environment {
  return JSON.parse(JSON.stringify(POSTMAN_DEMO_ENVIRONMENT)) as Environment
}

export function loadDefaultPostmanDemo(): boolean {
  const colStore = useCollectionsStore.getState()
  const envStore = useEnvironmentsStore.getState()
  if (!colStore.loaded || !envStore.loaded) return false
  if (colStore.collections.length > 0 || envStore.environments.length > 0) return false

  useCollectionsStore.setState({
    collections: [getDefaultPostmanDemoCollection()],
    loaded: true,
    loadError: false,
  })
  useEnvironmentsStore.setState({
    environments: [getDefaultPostmanDemoEnvironment()],
    activeEnvId: POSTMAN_DEMO_ENVIRONMENT.id,
    loaded: true,
    loadError: false,
  })
  void useCollectionsStore.getState().save()
  void useEnvironmentsStore.getState().save()
  return true
}
