# @khoralabs/memories-service-auth

Authorization strategies for the Memories database service HTTP adapter.

Supported schemes in this workstream:

- `none`
- `server-admin`

Configure at startup:

```text
MEMORIES_SERVICE_AUTH=none
MEMORIES_SERVICE_AUTH=server-admin
MEMORIES_SERVICE_ADMIN_TOKEN=your-token
```
