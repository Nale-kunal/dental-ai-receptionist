// Using Node.js native fetch (Node 18+)
async function testApi() {
  console.log('Testing live API endpoints against Neon PostgreSQL...');

  // 1. Login
  const loginRes = await fetch('http://localhost:3001/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.example.com', password: 'password123' })
  });
  const loginData: any = await loginRes.json();
  if (!loginData.ok && !loginData.success) {
    console.error('Login failed:', loginData);
    process.exit(1);
  }
  const token = loginData.data.accessToken || loginData.data.token;
  console.log('✓ Login successful, JWT obtained.');

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const endpoints = [
    { name: 'Appointments', url: 'http://localhost:3001/api/v1/appointments' },
    { name: 'Patients', url: 'http://localhost:3001/api/v1/patients' },
    { name: 'Doctors/Dentists', url: 'http://localhost:3001/api/v1/doctors' },
    { name: 'Services', url: 'http://localhost:3001/api/v1/services' },
    { name: 'Handoffs', url: 'http://localhost:3001/api/v1/handoffs' },
    { name: 'Conversations', url: 'http://localhost:3001/api/v1/conversations' },
    { name: 'Reports Summary', url: 'http://localhost:3001/api/v1/reports/summary' },
    { name: 'Clinic Schedules', url: 'http://localhost:3001/api/v1/schedules/clinic' },
    { name: 'Receptionist Settings', url: 'http://localhost:3001/api/v1/receptionist/settings' },
    { name: 'Clinic Info', url: 'http://localhost:3001/api/v1/clinic' },
    { name: 'Availability Slots', url: 'http://localhost:3001/api/v1/availability/slots' },
    { name: 'Audit Log', url: 'http://localhost:3001/api/v1/audit' }
  ];

  for (const ep of endpoints) {
    const res = await fetch(ep.url, { headers: authHeaders });
    const json: any = await res.json();
    if (res.ok && json.ok) {
      const count = Array.isArray(json.data) 
        ? `${json.data.length} items` 
        : json.data?.items 
          ? `${json.data.items.length} items (total: ${json.data.total})` 
          : 'object returned';
      console.log(`✓ ${ep.name}: 200 OK (${count})`);
    } else {
      console.error(`✗ ${ep.name} FAILED (${res.status}):`, json);
      process.exit(1);
    }
  }

  console.log('All API endpoints verified successfully!');
}

testApi().catch((err) => {
  console.error('Fatal error during API test:', err);
  process.exit(1);
});
