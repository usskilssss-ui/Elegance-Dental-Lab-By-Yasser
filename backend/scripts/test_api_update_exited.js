const http = require('http');

async function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email: 'sec@gmail.com', password: '123' });
    const req = http.request('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body).token));
    });
    req.write(data);
    req.end();
  });
}

async function testUpdate(token) {
  return new Promise((resolve, reject) => {
    // 1. Get an exited case
    const req = http.request('http://localhost:5000/api/cases', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const cases = JSON.parse(body);
        const exitedCase = cases.find(c => c.status === 'exited' || c.currentStage === 'exited');
        if (!exitedCase) return resolve('No exited case found');
        
        console.log('Original exited date:', exitedCase.stageTimestamps?.exited);
        
        // 2. Update it using the payload shape from secretary.ts
        const payload = JSON.stringify({
          stageTimestamps: {
            exited: '2026-09-09T00:00:00.000Z'
          }
        });
        
        const updateReq = http.request(`http://localhost:5000/api/cases/${exitedCase._id || exitedCase.id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }, (resUpdate) => {
          let updateBody = '';
          resUpdate.on('data', d => updateBody += d);
          resUpdate.on('end', () => {
            console.log('Update response:', resUpdate.statusCode, updateBody);
            
            // 3. Get it again to verify
            const verifyReq = http.request(`http://localhost:5000/api/cases/${exitedCase._id || exitedCase.id}`, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}` }
            }, (resVerify) => {
              let verifyBody = '';
              resVerify.on('data', d => verifyBody += d);
              resVerify.on('end', () => {
                const updatedCase = JSON.parse(verifyBody);
                console.log('Updated exited date from DB:', updatedCase.stageTimestamps?.exited);
                resolve();
              });
            });
            verifyReq.end();
          });
        });
        updateReq.write(payload);
        updateReq.end();
      });
    });
    req.end();
  });
}

async function run() {
  const token = await login();
  if (token) {
    await testUpdate(token);
  } else {
    console.log('Login failed');
  }
}

run();
