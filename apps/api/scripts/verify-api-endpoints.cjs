const http = require('http');

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/v1' + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/v1' + path,
      method: 'GET',
      headers: {},
    };
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('--- 1. Testing Login ---');
  const loginRes = await post('/auth/login', {
    email: 'admin@demo.example.com',
    password: 'password123',
  });
  console.log('Login Status:', loginRes.status, 'OK:', loginRes.body.ok);
  if (!loginRes.body.ok) {
    console.error('Login failed:', loginRes.body);
    process.exit(1);
  }
  const token = loginRes.body.data.accessToken;
  console.log('Logged in user:', loginRes.body.data.user.email, 'Clinic:', loginRes.body.data.user.clinicName);

  console.log('\n--- 2. Testing Conversations Contact Name ---');
  const convRes = await get('/conversations', token);
  console.log('Conversations Status:', convRes.status);
  const items = convRes.body.data.items || [];
  console.log('Conversations Count:', items.length);
  for (const c of items) {
    console.log(`- Conv ID: ${c.id}`);
    console.log(`  Patient Name: "${c.patientName}"`);
    console.log(`  Contact Name: "${c.contactName}"`);
    console.log(`  Phone: "${c.phone}"`);
    console.log(`  Last Activity: "${c.lastActivity}"`);
    if (c.patientName === 'WhatsApp user' || c.patientName === 'WhatsApp Patient') {
      console.error('FAIL: Generic placeholder name detected!');
      process.exit(1);
    }
  }

  console.log('\n--- 3. Testing Conversation Details ---');
  if (items.length > 0) {
    const detailRes = await get('/conversations/' + items[0].id, token);
    console.log('Detail Status:', detailRes.status);
    console.log('Detail Patient Name:', detailRes.body.data.conversation?.patientName);
    console.log('Detail Messages Count:', detailRes.body.data.messages?.length);
  }

  console.log('\n--- 4. Testing Clinic Signup (Onboarding) ---');
  const testClinicEmail = `doctor.${Date.now()}@testisolation.example.com`;
  const signupRes = await post('/auth/signup', {
    clinicName: 'Beacon Dental Care',
    fullName: 'Dr. Marcus Vance',
    email: testClinicEmail,
    password: 'SecurePassword123!',
    timezone: 'America/Chicago',
    phone: '+1 312 555 0188',
  });
  console.log('Signup Status:', signupRes.status, 'OK:', signupRes.body.ok);
  if (!signupRes.body.ok) {
    console.error('Signup failed:', signupRes.body);
    process.exit(1);
  }
  const clinicBToken = signupRes.body.data.accessToken;
  const clinicBId = signupRes.body.data.clinic.id;
  console.log('Clinic B created:', signupRes.body.data.clinic.name, 'ID:', clinicBId);

  console.log('\n--- 5. Testing Multi-Tenant Isolation (Clinic B cannot see Clinic A conversations) ---');
  const clinicBConvs = await get('/conversations', clinicBToken);
  console.log('Clinic B Conversations Count:', clinicBConvs.body.data.items?.length);
  if (clinicBConvs.body.data.items?.length !== 0) {
    console.error('FAIL: Clinic B leaked Clinic A conversations!');
    process.exit(1);
  }
  console.log('SUCCESS: Clinic B has 0 conversations from Clinic A. Tenant isolation verified!');

  console.log('\n--- 6. Testing Cross-Tenant IDOR Attack (Clinic B querying Clinic A conversation by ID) ---');
  if (items.length > 0) {
    const idorRes = await get('/conversations/' + items[0].id, clinicBToken);
    console.log('IDOR Query Status (Expected 404/403):', idorRes.status, idorRes.body.code);
    if (idorRes.status === 200) {
      console.error('FAIL: IDOR vulnerability! Clinic B was able to fetch Clinic A conversation!');
      process.exit(1);
    }
    console.log('SUCCESS: Cross-tenant access blocked with', idorRes.status, idorRes.body.code);
  }

  console.log('\nALL VERIFICATION CHECKS PASSED PERFECTLY!');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
