/**
 * Install Print Agent as a Windows Service
 * Run once as Administrator: node install-service.js
 */
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'ElegancePrintAgent',
  description: 'Elegance Dental Lab — Remote Print Agent',
  script: path.join(__dirname, 'agent.js'),
  nodeOptions: [],
  // Restart automatically if crashed / process killed
  grow: 0.25,
  wait: 2,
  maxRestarts: 100,
  maxRetries: 100,
});

svc.on('install', () => {
  svc.start();
  console.log('✅ Print Agent installed and started as Windows Service!');
  console.log('   You can manage it from: Services (services.msc)');
});

svc.on('error', (err) => {
  console.error('❌ Service error:', err);
});

svc.install();
