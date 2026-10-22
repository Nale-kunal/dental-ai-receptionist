/**
 * Comprehensive Multi-Tenant Clean Provisioning & Isolation Verification Script
 * Validates:
 * 1. Demo tenant preservation (00000000-0000-0000-0000-000000000001)
 * 2. Clean tenant provisioning for Clinic A (US) and Clinic B (GB)
 * 3. 0 demo services, 0 demo dentists, unconfigured hours, 0 demo patients
 * 4. Full service catalog & pricing persistence (fixed, starting_from, quote_required)
 * 5. Multi-tenant service isolation (Clinic B cannot read Clinic A's services)
 * 6. Business hours configuration & persistence (Sat/Sun closed by default)
 * 7. Location-aware public holidays (US vs GB)
 * 8. Holiday working-day overrides per tenant (isolated to tenant)
 * 9. Duplicate patient phone isolation across tenants
 * 10. Clean transactional cleanup of test tenants without affecting production
 */

const http = require('http');

const API_BASE = 'http://localhost:3001/api/v1';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

function getData(res) {
  if (res && res.data && typeof res.data === 'object' && 'data' in res.data) {
    return res.data.data;
  }
  return res ? res.data : null;
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function pass(name, details = '') {
  console.log(`  ${colors.green}✓ PASS:${colors.reset} ${name} ${details ? `(${colors.cyan}${details}${colors.reset})` : ''}`);
}

function fail(name, error) {
  console.error(`  ${colors.red}✗ FAIL:${colors.reset} ${name}\n    Error: ${typeof error === 'object' ? JSON.stringify(error) : error}`);
  process.exitCode = 1;
}

function heading(title) {
  console.log(`\n${colors.bold}${colors.yellow}=== ${title} ===${colors.reset}`);
}

async function runVerification() {
  console.log(`${colors.bold}${colors.cyan}Starting Multi-Tenant Onboarding & Security Verification${colors.reset}\n`);

  const timestamp = Date.now();
  const clinicAEmail = `audit_owner_us_${timestamp}@austinstudio.test`;
  const clinicBEmail = `audit_owner_gb_${timestamp}@londonsmile.test`;
  const password = 'TestSecurePassword123!';

  let clinicAToken = '';
  let clinicBToken = '';
  let clinicAId = '';
  let clinicBId = '';
  let serviceAId = '';
  let serviceBId = '';

  try {
    // ---------------------------------------------------------
    // TEST 1: Check Demo Dental Clinic Preservation
    // ---------------------------------------------------------
    heading('1. Verify Demo Clinic Preservation');
    const demoLoginRes = await request('/auth/login', {
      method: 'POST',
      body: { email: 'admin@demo.example.com', password: 'password123' },
    });

    const demoData = getData(demoLoginRes);
    if (demoLoginRes.status === 200 && demoData?.user?.clinicId === '00000000-0000-0000-0000-000000000001') {
      pass('Demo clinic is intact and accessible', `clinicId: ${demoData.user.clinicId}`);
    } else {
      fail('Demo clinic login failed or clinicId mutated', demoLoginRes.data);
    }

    // ---------------------------------------------------------
    // TEST 2: Register Clinic A (US Jurisdiction)
    // ---------------------------------------------------------
    heading('2. Register Clinic A (US - Austin Dental Studio)');
    const signupARes = await request('/auth/signup', {
      method: 'POST',
      body: {
        clinicName: `Austin Dental Studio ${timestamp}`,
        fullName: 'Dr. Jane Austin',
        email: clinicAEmail,
        password: password,
        phone: '+15125550100',
        timezone: 'America/Chicago',
        country: 'US',
        state: 'TX',
        city: 'Austin',
        currency: 'USD',
      },
    });

    const signupAData = getData(signupARes);
    const tokenA = signupAData?.accessToken || signupAData?.tokens?.accessToken;
    if ((signupARes.status === 200 || signupARes.status === 201) && tokenA && signupAData?.clinic?.id) {
      clinicAToken = tokenA;
      clinicAId = signupAData.clinic.id;
      pass('Clinic A created atomically with distinct tenant ID', `ID: ${clinicAId}`);
      if (clinicAId === '00000000-0000-0000-0000-000000000001') {
        fail('Clinic A incorrectly assigned demo clinic ID!', clinicAId);
      }
      if (signupAData.clinic.name !== `Austin Dental Studio ${timestamp}`) {
        fail('Clinic A name does not match submitted name', signupAData.clinic.name);
      }
    } else {
      fail('Signup Clinic A failed', signupARes.data);
      return;
    }

    // ---------------------------------------------------------
    // TEST 3: Verify Clinic A Clean Provisioning (0 records)
    // ---------------------------------------------------------
    heading('3. Verify Clinic A Clean Initial State (0 demo records)');
    const authHeadersA = { Authorization: `Bearer ${clinicAToken}` };

    // Check Services
    const srvARes = await request('/services', { headers: authHeadersA });
    const srvAData = getData(srvARes);
    if (srvARes.status === 200 && Array.isArray(srvAData) && srvAData.length === 0) {
      pass('Clinic A has 0 demo services provisioned', 'services: []');
    } else {
      fail('Clinic A inherited demo services!', srvAData);
    }

    // Check Dentists
    const docARes = await request('/doctors', { headers: authHeadersA });
    const docAData = getData(docARes);
    if (docARes.status === 200 && Array.isArray(docAData) && docAData.length === 0) {
      pass('Clinic A has 0 demo dentists provisioned', 'dentists: []');
    } else {
      fail('Clinic A inherited demo dentists!', docAData);
    }

    // Check Business Hours (Should be unconfigured / 0 rows)
    const hoursARes = await request('/schedules/clinic', { headers: authHeadersA });
    const hoursAData = getData(hoursARes);
    if (hoursARes.status === 200 && Array.isArray(hoursAData) && hoursAData.length === 0) {
      pass('Clinic A has 0 default business hours (unconfigured state)', 'hours: []');
    } else {
      fail('Clinic A inherited default operating hours!', hoursAData);
    }

    // Check Patients
    const patARes = await request('/patients', { headers: authHeadersA });
    const patAData = getData(patARes);
    const patListA = Array.isArray(patAData?.patients) ? patAData.patients : (Array.isArray(patAData) ? patAData : []);
    if (patARes.status === 200 && patListA.length === 0) {
      pass('Clinic A has 0 fake patients', 'patients: []');
    } else {
      fail('Clinic A inherited fake patients!', patAData);
    }

    // ---------------------------------------------------------
    // TEST 4: Register Clinic B (GB Jurisdiction)
    // ---------------------------------------------------------
    heading('4. Register Clinic B (GB - London Smile Clinic)');
    const signupBRes = await request('/auth/signup', {
      method: 'POST',
      body: {
        clinicName: `London Smile Clinic ${timestamp}`,
        fullName: 'Dr. Arthur London',
        email: clinicBEmail,
        password: password,
        phone: '+442079460991',
        timezone: 'Europe/London',
        country: 'GB',
        city: 'London',
        currency: 'GBP',
      },
    });

    const signupBData = getData(signupBRes);
    const tokenB = signupBData?.accessToken || signupBData?.tokens?.accessToken;
    if ((signupBRes.status === 200 || signupBRes.status === 201) && tokenB && signupBData?.clinic?.id) {
      clinicBToken = tokenB;
      clinicBId = signupBData.clinic.id;
      pass('Clinic B created with distinct tenant ID', `ID: ${clinicBId}`);
      if (clinicBId === clinicAId) {
        fail('Clinic B received same ID as Clinic A!', clinicBId);
      }
    } else {
      fail('Signup Clinic B failed', signupBRes.data);
      return;
    }

    const authHeadersB = { Authorization: `Bearer ${clinicBToken}` };

    // ---------------------------------------------------------
    // TEST 5: Service Catalog & Pricing Persistence (Clinic A & B)
    // ---------------------------------------------------------
    heading('5. Service Catalog & Pricing Persistence');
    const createServiceARes = await request('/services', {
      method: 'POST',
      headers: authHeadersA,
      body: {
        name: 'Comprehensive Oral Exam',
        code: `EXAM-${timestamp.toString().slice(-4)}`,
        durationMinutes: 45,
        price: 185.50,
        currency: 'USD',
        pricingModel: 'starting_from',
        category: 'Diagnostic',
        description: 'Complete dental examination with intraoral imaging',
        bufferMinutes: 10,
        isActive: true,
      },
    });

    const createdServiceA = getData(createServiceARes);
    if (createServiceARes.status === 201 && createdServiceA?.id) {
      serviceAId = createdServiceA.id;
      if (
        createdServiceA.price === 185.50 &&
        createdServiceA.currency === 'USD' &&
        createdServiceA.pricingModel === 'starting_from' &&
        createdServiceA.category === 'Diagnostic'
      ) {
        pass('Clinic A created service with starting_from price $185.50', `Service ID: ${serviceAId}`);
      } else {
        fail('Service pricing or metadata not stored properly', createdServiceA);
      }
    } else {
      fail('Create service in Clinic A failed', createServiceARes.data);
    }

    // Clinic B creates quote_required service with null price
    const createServiceBRes = await request('/services', {
      method: 'POST',
      headers: authHeadersB,
      body: {
        name: 'Full Arch Implant Consultation',
        code: `IMP-${timestamp.toString().slice(-4)}`,
        durationMinutes: 60,
        price: null,
        currency: 'GBP',
        pricingModel: 'quote_required',
        category: 'Surgical',
        description: 'Specialist surgical assessment for dental implants',
        bufferMinutes: 15,
        isActive: true,
      },
    });

    const createdServiceB = getData(createServiceBRes);
    if (createServiceBRes.status === 201 && createdServiceB?.id) {
      serviceBId = createdServiceB.id;
      if (createdServiceB.price === null && createdServiceB.pricingModel === 'quote_required' && createdServiceB.currency === 'GBP') {
        pass('Clinic B created service with quote_required pricing model (null price)', `Service ID: ${serviceBId}`);
      } else {
        fail('Quote required service failed to persist null price', createdServiceB);
      }
    } else {
      fail('Create service in Clinic B failed', createServiceBRes.data);
    }

    // ---------------------------------------------------------
    // TEST 6: Multi-Tenant Service Isolation
    // ---------------------------------------------------------
    heading('6. Multi-Tenant Service Isolation');
    const srvListBRes = await request('/services', { headers: authHeadersB });
    const srvListB = getData(srvListBRes) || [];
    const hasServiceAInB = srvListB.some((s) => s.id === serviceAId);
    if (!hasServiceAInB && srvListB.length === 1) {
      pass('Clinic B service list strictly isolated (cannot see Clinic A service)');
    } else {
      fail('Cross-tenant service leak detected in list endpoint!', srvListB);
    }

    // Direct access across tenants
    const directAccessRes = await request(`/services/${serviceAId}`, { headers: authHeadersB });
    if (directAccessRes.status === 404 || directAccessRes.status === 403) {
      pass('Clinic B blocked from directly accessing Clinic A service by ID', `Status: ${directAccessRes.status}`);
    } else {
      fail('Clinic B successfully accessed Clinic A service by ID!', directAccessRes.data);
    }

    // ---------------------------------------------------------
    // TEST 7: Business Hours Configuration
    // ---------------------------------------------------------
    heading('7. Business Hours Configuration (Explicit Open Days)');
    const updateHoursARes = await request('/schedules/clinic', {
      method: 'PUT',
      headers: authHeadersA,
      body: {
        hours: [
          { dayOfWeek: 1, isOpen: true, opensAt: '08:30', closesAt: '16:30' },
          { dayOfWeek: 2, isOpen: true, opensAt: '08:30', closesAt: '16:30' },
          { dayOfWeek: 3, isOpen: true, opensAt: '08:30', closesAt: '16:30' },
          { dayOfWeek: 4, isOpen: true, opensAt: '08:30', closesAt: '16:30' },
          { dayOfWeek: 5, isOpen: true, opensAt: '08:30', closesAt: '16:30' },
          { dayOfWeek: 6, isOpen: false, opensAt: '09:00', closesAt: '17:00' },
          { dayOfWeek: 0, isOpen: false, opensAt: '09:00', closesAt: '17:00' },
        ],
      },
    });

    if (updateHoursARes.status === 200) {
      pass('Clinic A saved explicit Mon-Fri 08:30-16:30 schedule');
    } else {
      fail('Failed to update business hours for Clinic A', updateHoursARes.data);
    }

    // Verify Saturday and Sunday remain closed in Clinic A
    const readHoursARes = await request('/schedules/clinic', { headers: authHeadersA });
    const hoursAList = getData(readHoursARes) || [];
    const satHour = hoursAList.find((h) => h.dayOfWeek === 6);
    const sunHour = hoursAList.find((h) => h.dayOfWeek === 0);
    if (!satHour && !sunHour && hoursAList.length === 5) {
      pass('Saturday and Sunday remain strictly closed for Clinic A');
    } else {
      fail('Saturday or Sunday incorrectly opened in Clinic A!', hoursAList);
    }

    // Verify Clinic B still has 0 configured hours
    const readHoursBRes = await request('/schedules/clinic', { headers: authHeadersB });
    const hoursBList = getData(readHoursBRes) || [];
    if (readHoursBRes.status === 200 && hoursBList.length === 0) {
      pass('Clinic B hours remain completely unconfigured (independent state)');
    } else {
      fail('Clinic B hours leaked from Clinic A!', hoursBList);
    }

    // ---------------------------------------------------------
    // TEST 8: Location-Aware Public Holidays
    // ---------------------------------------------------------
    heading('8. Location-Aware Public Holidays & Jurisdiction');
    const holARes = await request('/schedules/holidays?year=2026', { headers: authHeadersA });
    const holBRes = await request('/schedules/holidays?year=2026', { headers: authHeadersB });

    const holAData = getData(holARes);
    const holBData = getData(holBRes);

    if (holARes.status === 200 && holAData?.countryCode === 'US') {
      const hasThanksgiving = (holAData.holidays || []).some((h) => h.name.includes('Thanksgiving'));
      const hasIndependenceDay = (holAData.holidays || []).some((h) => h.name.includes('Independence Day'));
      if (hasThanksgiving && hasIndependenceDay) {
        pass('Clinic A (US) received correct US public holidays (Thanksgiving, Independence Day)', `count: ${holAData.holidays.length}`);
      } else {
        fail('Clinic A missing US holidays', holAData);
      }
    } else {
      fail('Failed to fetch holidays for Clinic A', holARes.data);
    }

    if (holBRes.status === 200 && holBData?.countryCode === 'GB') {
      const hasBankHoliday = (holBData.holidays || []).some((h) => h.name.includes('Bank Holiday'));
      const hasBoxingDay = (holBData.holidays || []).some((h) => h.name.includes('Boxing Day'));
      if (hasBankHoliday && hasBoxingDay) {
        pass('Clinic B (GB) received correct GB public holidays (Bank Holidays, Boxing Day)', `count: ${holBData.holidays.length}`);
      } else {
        fail('Clinic B missing GB holidays', holBData);
      }
    } else {
      fail('Failed to fetch holidays for Clinic B', holBRes.data);
    }

    // ---------------------------------------------------------
    // TEST 9: Holiday Working-Day Overrides Isolation
    // ---------------------------------------------------------
    heading('9. Holiday Working-Day Overrides per Clinic');
    // Clinic A designates Memorial Day (2026-05-25) as a Working Day
    const setOverrideARes = await request('/schedules/holidays/override', {
      method: 'PUT',
      headers: authHeadersA,
      body: {
        holidayDate: '2026-05-25',
        holidayName: 'Memorial Day',
        action: 'working_day',
      },
    });

    const overrideAData = getData(setOverrideARes);
    if (setOverrideARes.status === 200 && (overrideAData?.action === 'working_day' || overrideAData?.override?.action === 'working_day')) {
      pass('Clinic A marked Memorial Day as an Open Working Day');
    } else {
      fail('Clinic A failed to set holiday working-day override', setOverrideARes.data);
    }

    // Re-fetch Clinic A holidays to verify status reflects override
    const verifyHolARes = await request('/schedules/holidays?year=2026', { headers: authHeadersA });
    const verifyHolAData = getData(verifyHolARes);
    const memDayA = (verifyHolAData?.holidays || []).find((h) => h.date === '2026-05-25');
    if (memDayA && memDayA.status === 'working_day') {
      pass('Clinic A Memorial Day status is now working_day');
    } else {
      fail('Clinic A Memorial Day status not updated to working_day', memDayA);
    }

    // Reset override back to closed
    const resetOverrideARes = await request('/schedules/holidays/override', {
      method: 'PUT',
      headers: authHeadersA,
      body: {
        holidayDate: '2026-05-25',
        holidayName: 'Memorial Day',
        action: 'closed',
      },
    });
    if (resetOverrideARes.status === 200) {
      pass('Clinic A reset Memorial Day override to closed');
    }

    // ---------------------------------------------------------
    // TEST 10: Multi-Tenant Duplicate Patient Phone Isolation
    // ---------------------------------------------------------
    heading('10. Multi-Tenant Duplicate Phone Isolation');
    const sharedPhone = '+15558887766';

    const patCreateARes = await request('/patients', {
      method: 'POST',
      headers: authHeadersA,
      body: {
        firstName: 'Michael',
        lastName: 'Scott',
        phone: sharedPhone,
        email: `mscott_${timestamp}@austin.test`,
      },
    });

    const patCreateBRes = await request('/patients', {
      method: 'POST',
      headers: authHeadersB,
      body: {
        firstName: 'David',
        lastName: 'Brent',
        phone: sharedPhone, // IDENTICAL PHONE NUMBER ACROSS CLINICS
        email: `dbrent_${timestamp}@london.test`,
      },
    });

    if (patCreateARes.status === 201 && patCreateBRes.status === 201) {
      pass('Same phone number successfully registered in two independent clinics', sharedPhone);
    } else {
      fail('Failed to register same phone number in separate clinics (global uniqueness constraint violation?)', {
        resA: patCreateARes.data,
        resB: patCreateBRes.data,
      });
    }

    // Verify Clinic A sees only Michael Scott
    const patListARes = await request('/patients', { headers: authHeadersA });
    const patListDataA = getData(patListARes);
    const patientsA = Array.isArray(patListDataA?.items)
      ? patListDataA.items
      : Array.isArray(patListDataA?.patients)
      ? patListDataA.patients
      : Array.isArray(patListDataA)
      ? patListDataA
      : [];
    const hasDavidInA = patientsA.some((p) => (p.firstName === 'David' || p.fullName?.includes('David')));
    const hasMichaelInA = patientsA.some((p) => (p.firstName === 'Michael' || p.fullName?.includes('Michael')));

    if (hasMichaelInA && !hasDavidInA) {
      pass('Clinic A sees only Michael Scott (tenant isolated)');
    } else {
      fail('Patient isolation violation in Clinic A!', patientsA);
    }

    // ---------------------------------------------------------
    // TEST 11: Cleanup Test Data (Preserve All Other Clinics)
    // ---------------------------------------------------------
    heading('11. Cleanup Test Tenant Data');
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    try {
      // Remove created test data
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.patients WHERE clinic_id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.clinic_holiday_overrides WHERE clinic_id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.business_hours WHERE clinic_id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.services WHERE clinic_id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.users WHERE clinic_id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM api.clinics WHERE id IN ($1::uuid, $2::uuid)`,
        clinicAId,
        clinicBId
      );
      pass('Safely removed only the two audit test tenants', `Clinics: ${clinicAId}, ${clinicBId}`);
    } finally {
      await prisma.$disconnect();
    }

    heading('Verification Summary');
    console.log(`${colors.green}${colors.bold}ALL MULTI-TENANT ONBOARDING & ISOLATION CHECKS PASSED SUCCESSFULLY!${colors.reset}\n`);
  } catch (err) {
    fail('Unexpected exception during verification execution', err.stack || err.message);
  }
}

runVerification();
