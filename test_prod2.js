const https = require('https');

const req = https.request('https://elegance-dental-lab-by-yasser-production.up.railway.app/api/cases/health', {
  method: 'GET'
}, (res) => {
  console.log('Health Status:', res.statusCode);
});
req.on('error', e => console.error(e));
req.end();

const req2 = https.request('https://elegance-dental-lab-by-yasser-production.up.railway.app/api/doctor-pricing', {
  method: 'GET'
}, (res) => {
  console.log('Doctor Pricing Status:', res.statusCode);
});
req2.on('error', e => console.error(e));
req2.end();
