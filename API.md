# DeskOS API Documentation

## Base URL

```
http://localhost:3001/api
```

## Endpoints

### Health Check

**GET** `/health`

Response:
```json
{
  "status": "ok",
  "timestamp": 1234567890
}
```

### Devices

**GET** `/devices`

Get all devices.

Response:
```json
[
  {
    "id": "device-123",
    "type": "local",
    "name": "Main PC",
    "status": "online",
    "lastSeen": 1234567890,
    "capabilities": ["cpu", "ram", "network"],
    "metadata": {}
  }
]
```

**GET** `/devices/:id`

Get device details with recent data.

Response:
```json
{
  "device": { ... },
  "data": [
    {
      "deviceId": "device-123",
      "timestamp": 1234567890,
      "data": { "cpu": 45, "ram": 62 }
    }
  ]
}
```

**GET** `/devices/:id/data?limit=100`

Get device data history.

Query Parameters:
- `limit`: Maximum number of records (max 1000)

Response:
```json
[
  {
    "deviceId": "device-123",
    "timestamp": 1234567890,
    "data": { ... }
  }
]
```

### System Metrics

**GET** `/system/metrics`

Get current system metrics for local PC.

Response:
```json
{
  "cpu": 45.5,
  "ram": {
    "used": 4294967296,
    "total": 16294967296,
    "percentage": 26.3
  },
  "uptime": 86400,
  "hostname": "my-pc",
  "platform": "win32"
}
```

### Events

**GET** `/events?type=device:registered&limit=50`

Get event history.

Query Parameters:
- `type`: Optional event type filter
- `limit`: Maximum number of events (max 1000)

Response:
```json
[
  {
    "id": "event-123",
    "type": "device:registered",
    "timestamp": 1234567890,
    "source": "device-manager",
    "payload": { ... },
    "priority": "normal"
  }
]
```

### Dashboard

**GET** `/dashboard/summary`

Get dashboard summary with aggregated data.

Response:
```json
{
  "devices": {
    "total": 5,
    "online": 4,
    "offline": 1
  },
  "system": { ... },
  "recentEvents": [ ... ]
}
```

## WebSocket Events

Connect to WebSocket at `ws://localhost:3001`

### Client -> Server

**subscribe:device**
```json
{
  "deviceId": "device-123"
}
```

**get:devices**
No payload required.

**get:device**
```json
{
  "deviceId": "device-123"
}
```

**get:event-history**
```json
{
  "eventType": "device:registered"
}
```

**subscribe:events**
No payload required.

### Server -> Client

**devices:list**
```json
[{ device objects }]
```

**device:update**
```json
{
  "deviceId": "device-123",
  "data": { ... },
  "timestamp": 1234567890
}
```

**device:details**
```json
{
  "device": { ... },
  "data": [ ... ]
}
```

**event:new**
```json
{
  "id": "event-123",
  "type": "...",
  "timestamp": 1234567890,
  "source": "...",
  "payload": { ... },
  "priority": "..."
}
```

**event:history**
```json
[{ event objects }]
```

**error**
```json
{
  "message": "Error description"
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message"
}
```

HTTP Status Codes:
- 200: Success
- 404: Not found
- 500: Server error

## Rate Limiting

Currently no rate limiting. Will be added in production.

## Authentication

Currently no authentication required. Will be added in security update.

## Examples

### JavaScript/TypeScript

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api'
});

// Get all devices
const devices = await api.get('/devices');

// Get device details
const device = await api.get(`/devices/${deviceId}`);

// Get system metrics
const metrics = await api.get('/system/metrics');

// Get dashboard summary
const summary = await api.get('/dashboard/summary');
```

### Python

```python
import requests

BASE_URL = 'http://localhost:3001/api'

# Get devices
response = requests.get(f'{BASE_URL}/devices')
devices = response.json()

# Get system metrics
response = requests.get(f'{BASE_URL}/system/metrics')
metrics = response.json()
```

### cURL

```bash
# Get all devices
curl http://localhost:3001/api/devices

# Get system metrics
curl http://localhost:3001/api/system/metrics

# Get event history
curl "http://localhost:3001/api/events?limit=10"
```
