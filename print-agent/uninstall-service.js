/**
 * Uninstall Print Agent Windows Service
 * Run as Administrator: node uninstall-service.js
 */
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'ElitePrintAgent',
  script: path.join(__dirname, 'agent.js'),
});

svc.on('uninstall', () => {
  console.log('✅ Print Agent service uninstalled.');
});

svc.uninstall();
