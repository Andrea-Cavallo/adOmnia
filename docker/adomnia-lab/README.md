# adOmnia local lab

This lab gives adOmnia local services for manual verification:

- Redpanda Kafka on `localhost:19092`
- Redpanda Console on `http://localhost:18081`
- Mock/echo HTTP API on `http://localhost:18080`

Run:

```powershell
docker compose -f docker/adomnia-lab/docker-compose.yml up --build
```

Useful endpoints:

- `GET http://localhost:18080/health`
- `GET http://localhost:18080/json`
- `POST http://localhost:18080/echo`
- `GET http://localhost:18080/slow?ms=500`
- `GET http://localhost:18080/status?code=418`

Kafka:

- Broker: `localhost:19092`
- Topic: `adomnia.lab.events`

In adOmnia, load the built-in demo workspace from the welcome screen or import `workspaces/adomnia-full-lab.adomnia`.
