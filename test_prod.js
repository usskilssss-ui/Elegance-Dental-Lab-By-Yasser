const http = require('https');

const req = http.request('https://elegance-dental-lab-by-yasser-production.up.railway.app/api/doctor-pricing', {
  method: 'GET'
}, (res) => {
  console.log('Status:', res.statusCode);
});
req.end();
