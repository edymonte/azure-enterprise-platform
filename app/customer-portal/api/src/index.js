'use strict';

// Datadog APM must be initialised before any other module is loaded.
// Disabled by default; enabled per environment through Helm values.
if (process.env.DD_TRACE_ENABLED === 'true') {
  require('dd-trace').init({ logInjection: true, runtimeMetrics: true });
}

const { createApp, log } = require('./app');

const port = Number(process.env.PORT || 8080);
const server = createApp().listen(port, () => log('info', `customer-portal-api listening on ${port}`));

// Graceful shutdown: Kubernetes sends SIGTERM before killing the pod.
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, draining connections');
  server.close(() => process.exit(0));
});
