const http = require('http');

async function testPricing() {
  const loginData = JSON.stringify({ email: 'sec@gmail.com', password: 'password123' });
  const loginReq = http.request('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginData)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const parsed = JSON.parse(data);
      if (!parsed.token) {
        console.error('Login failed', parsed);
        return;
      }
      const token = parsed.token;
      console.log('Got token');

      const putData = JSON.stringify({
        doctorName: 'موسى اركان',
        prices: { zircon: 600 }
      });

      const putReq = http.request('http://localhost:5000/api/doctor-pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(putData)
        }
      }, (putRes) => {
        let putDataResp = '';
        putRes.on('data', chunk => putDataResp += chunk);
        putRes.on('end', () => {
          console.log('Status:', putRes.statusCode);
          console.log('Response:', putDataResp);
        });
      });
      putReq.write(putData);
      putReq.end();
    });
  });
  loginReq.write(loginData);
  loginReq.end();
}

testPricing();
