# IIS reverse proxy and document extraction

The browser's generic “Something went wrong” message can originate in the Express
API. `ERR_ERL_UNDEFINED_IP_ADDRESS` means Express could not obtain a peer IP.
This can occur with a disconnected socket or an IIS transport that does not expose
a normal TCP remote address. The `X-Forwarded-For` and `Forwarded` messages mean
proxy headers were present while the default rate limiter was using socket-based
client identification. A subsequent `Hash.update(undefined)` in draft-8 headers
can turn that missing identifier into a 500 response. These logs alone do not
indicate a database or CV-parser failure.

Document extraction now uses the authenticated account ID after session validation.
Unauthenticated login and Google routes use a validated Express client IP, then the
socket peer, then a shared `ip:unavailable` bucket. Rate limits remain enforced even
when no IP is available. The shared fallback can make users share a login quota;
configure a trusted proxy when per-client quotas are needed.

## Proxy configuration

The default is to ignore forwarded headers when identifying clients. If IIS and/or
Next.js proxy requests to Express, set `TRUSTED_PROXY_ADDRESSES` in `backend/.env`
only after verifying the proxy chain and header handling:

```env
# IIS and Next.js connect from the same host, and sanitize proxy headers:
TRUSTED_PROXY_ADDRESSES=loopback
```

For a remote IIS proxy, use its actual IP (or narrowly scoped subnet), for example:

```env
TRUSTED_PROXY_ADDRESSES=10.20.30.40/32
```

Trust only proxy addresses under your control. Restrict direct backend access, and
configure the public-facing proxy to remove incoming client-supplied forwarded
headers and set the actual client IP. With multiple proxies, each hop must preserve
the verified chain correctly; list all trusted proxy hops. Do not set blanket
`trust proxy: true`, broad public subnets, or guessed hop counts. `Forwarded` alone
is intentionally not used for rate-limit keys: have IIS provide a sanitized
`X-Forwarded-For` chain if per-client login quotas are required. A trusted-proxy
setting cannot reconstruct a socket peer that the transport never supplies; account
limits and the safe fallback handle that case.

Set `FRONTEND_URL` to the exact external browser origin, including HTTPS and any
nonstandard port. Changes here do not require changing origin checks or weakening
session cookie protection.

## Apply on the Windows host

Copy/deploy the updated backend source and configuration, then from the repository
root run:

```powershell
npm run build -w backend
```

Restart or recycle the IIS-managed Node process so it loads the new build and
environment. Development processes should also be restarted. No database migration
is required for this fix. Retry “Extract to profile” with a single document. If a
500 remains, inspect the new backend exception; the prior generic browser message
is not enough to identify an unrelated parser, file-storage, or database error.
