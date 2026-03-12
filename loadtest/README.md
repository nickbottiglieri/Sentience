# Load Testing

Simulates concurrent AI game lifecycles to measure throughput and latency.

## Single Process

```bash
node server.js
node loadtest/run.js
```

## Two Processes + Nginx Load Balancer

```bash
# Terminal 1: Redis
redis-server

# Terminal 2 & 3: App instances
REDIS_URL=redis://localhost:6379 PORT=3001 node server.js
REDIS_URL=redis://localhost:6379 PORT=3002 node server.js

# Terminal 4: Nginx load balancer
nginx -c $(pwd)/loadtest/nginx.conf

# Terminal 5: Run test
node loadtest/run.js

# Stop nginx when done
nginx -s stop
```

## Options

```
--url=URL       Target server (default: http://localhost:3000)
--games=N       Concurrent games per round (default: 50)
--rounds=N      Sequential rounds (default: 3)
```
