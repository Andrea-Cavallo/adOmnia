import type { Collection, Environment, EnvVariable } from '@/lib/types'

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
