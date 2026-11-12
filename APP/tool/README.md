# Production-connected Chrome preview

From the repository root, keep the loopback proxy running:

```sh
node APP/tool/production_preview_proxy.mjs
```

In a second terminal:

```sh
cd APP
flutter run -d chrome --web-port=50231
```

The debug app's localhost API forwards to `https://api.trustpayhq.com` using normal TLS validation. The proxy binds only to `127.0.0.1:3001`, permits the two local preview origins on port 50231, strips cookies/forwarded headers, and never retries a request. It does not log credentials or financial payloads. Release builds use their validated production configuration directly.

If the preview loses its connection, confirm that this proxy process is running and that `/api/health/ready` succeeds through it. Changing the preview port requires updating the explicit origin allowlist.
