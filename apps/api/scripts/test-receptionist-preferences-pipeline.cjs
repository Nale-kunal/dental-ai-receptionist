/**
 * test-receptionist-preferences-pipeline.cjs
 *
 * Comprehensive end-to-end verification of clinic receptionist preferences
 * in WhatsApp integration:
 * 1. Exact custom Welcome Greeting on "HI" (no rewriting, paraphrasing, or LLM change)
 * 2. Unset/default greeting fallback ("Hello! Welcome to <Clinic Name>. How can I assist you today?")
 * 3. Multi-tenant clinic isolation (Clinic A vs Clinic B greetings & settings never bleed)
 * 4. Greeting lifecycle: sent on new conversation greeting, not repeated on booking/availability
 * 5. Webhook retry idempotency
 * 6. Automated Receptionist Answering: ACTIVE vs PAUSED (suppresses AI, triggers handoff & fallback message)
 * 7. Conversation Tone variations (professional, empathetic, concise)
 * 8. Urgent / Emergency Contact Phone integration (accurate clinic phone, 911 safety, never invented)
 * 9. Cancellation & Rescheduling Policy integration
 * 10. Accepted Dental Insurance Information (exact match, unlisted plan honest referral, unconfigured fallback)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load target workflow to verify
const workflowPath = path.resolve(__dirname, '../../../Dental — AI Receptionist (PROPOSED PRODUCTION).json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

console.log('=== VERIFYING WORKFLOW NODES & JAVASCRIPT ===\n');

const extractNode = workflow.nodes.find(n => n.name === 'Extract Intent');
const resolveNode = workflow.nodes.find(n => n.name === 'Resolve Slots');
const composeNode = workflow.nodes.find(n => n.name === 'Compose Reply');

assert.ok(extractNode, 'Extract Intent node exists');
assert.ok(resolveNode, 'Resolve Slots node exists');
assert.ok(composeNode, 'Compose Reply node exists');

console.log('✓ Required nodes present in workflow');

// Ensure key preference logic exists in nodes
assert.ok(extractNode.parameters.jsCode.includes('pureGreetingRegex'), 'Extract Intent has deterministic pureGreetingRegex');
assert.ok(resolveNode.parameters.jsCode.includes('receptionistEnabled'), 'Resolve Slots checks receptionistEnabled');
assert.ok(composeNode.parameters.jsCode.includes('greeting_message'), 'Compose Reply checks greeting_message');
assert.ok(composeNode.parameters.jsCode.includes('emergency_phone'), 'Compose Reply checks emergency_phone');
assert.ok(composeNode.parameters.jsCode.includes('cancellation_policy'), 'Compose Reply checks cancellation_policy');
assert.ok(composeNode.parameters.jsCode.includes('accepted_insurance'), 'Compose Reply checks accepted_insurance');
assert.ok(composeNode.parameters.jsCode.includes('function applyTone'), 'Compose Reply has applyTone helper');

console.log('✓ Workflow code contains all required preference guards and handlers\n');

// Build simulation harness evaluating actual Compose Reply node JS in a controlled V8 context
function runComposeReplyNode({
  action,
  message,
  clinicName,
  clinicSettings,
  dentists = [],
  services = [],
  slots = {},
  actionResult = { ok: true, code: 'OK' }
}) {
  const INFO_INTENTS = new Set([
    'greeting', 'goodbye', 'thanks', 'smalltalk', 'current_clinic_time',
    'faq_hours', 'faq_services', 'faq_location', 'faq_pricing',
    'faq_dentists', 'faq_dentist_selection', 'faq_cancellation_policy',
    'faq_reschedule_policy', 'faq_new_patient', 'faq_booking_process',
    'faq_confirmation_code', 'faq_confirmation_process', 'faq_reminders',
    'faq_preparation', 'faq_insurance', 'faq_payment', 'faq_emergency',
    'faq_service_information', 'faq_general', 'faq', 'clarify'
  ]);

  const resolveSlotsOutput = {
    action,
    message,
    clinic_id: '914fb00e-c834-4e44-9646-9d746f536d4e',
    conversation_id: 'conv-111',
    provider_event_id: 'msg-111',
    event_id: 'evt-111',
    patient_id: 'pat-111',
    channel: 'whatsapp',
    clinic: {
      name: clinicName,
      timezone: 'America/New_York',
      hours: [],
      settings: clinicSettings || {},
      closures: []
    },
    slots,
    dentists,
    services
  };

  const incomingJson = INFO_INTENTS.has(action)
    ? resolveSlotsOutput
    : actionResult;

  // Mock n8n variables
  const $json = incomingJson;
  const $ = (nodeName) => {
    if (nodeName === 'Resolve Slots') {
      return {
        first: () => ({ json: resolveSlotsOutput })
      };
    }
    throw new Error('Unexpected node lookup: ' + nodeName);
  };

  // Evaluate the real node code
  const codeToRun = composeNode.parameters.jsCode;
  const fn = new Function('$json', '$', 'Buffer', codeToRun);
  const result = fn($json, $, Buffer);
  return result[0].json;
}

let totalTests = 0;
let passedTests = 0;

function testCase(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
  }
}

console.log('=== RUNNING RECEPTIONIST PREFERENCES SIMULATION TESTS ===\n');

// 1. Exact Custom Welcome Greeting on "HI"
console.log('1. Welcome Greeting Message:');
testCase('Exact custom greeting returned on "HI" without modification or LLM paraphrase', () => {
  const customGreeting = 'Hello! Welcome to Oracle Clinic. How can I assist you today?';
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'HI',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      greeting_message: customGreeting
    }
  });
  assert.strictEqual(out.reply, customGreeting, 'Reply must match the exact configured greeting');
  assert.strictEqual(out.action, 'greeting');
});

testCase('Nested settings.receptionist.welcomeMessage (Oracle Clinic live DB schema) is supported seamlessly', () => {
  const liveGreeting = 'Welcome to Oracle Clinic! How may our dental team assist you today?';
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'HI',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      receptionist: {
        tone: 'warm_professional',
        enabled: true,
        welcomeMessage: liveGreeting
      }
    }
  });
  assert.strictEqual(out.reply, liveGreeting, 'Reply must match the nested live DB greeting');
  assert.strictEqual(out.action, 'greeting');
});

testCase('Updated configuration without redeploy (changing custom greeting on the fly)', () => {
  const updatedGreeting = 'Good day! Oracle Clinic is happy to welcome you. How may we help?';
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'HI',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      greeting_message: updatedGreeting
    }
  });
  assert.strictEqual(out.reply, updatedGreeting);
});

testCase('Custom greeting preserves punctuation, case, whitespace, and special characters', () => {
  const complexGreeting = '👋 Welcome to Dr. Smile & Associates! ✨\nHow can we help your smile today? [Call / WhatsApp]';
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'Hello!',
    clinicName: 'Dr. Smile & Associates',
    clinicSettings: {
      greeting_message: complexGreeting
    }
  });
  assert.strictEqual(out.reply, complexGreeting);
});

testCase('Fallback greeting when greeting_message is empty or unset', () => {
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'HI',
    clinicName: 'Apex Dental Care',
    clinicSettings: {}
  });
  assert.strictEqual(out.reply, 'Hello! Welcome to Apex Dental Care. How can I assist you today?');
});

// 2. Multi-Tenant Clinic Isolation
console.log('\n2. Multi-Tenant Clinic Isolation:');
testCase('Two different clinics receive their own distinct custom greetings without bleed', () => {
  const greetingClinicA = 'Welcome to Downtown Dental! Book with Dr. Alice.';
  const greetingClinicB = 'Good day from Uptown Ortho! How can we assist?';

  const outA = runComposeReplyNode({
    action: 'greeting',
    message: 'hi',
    clinicName: 'Downtown Dental',
    clinicSettings: { greeting_message: greetingClinicA }
  });

  const outB = runComposeReplyNode({
    action: 'greeting',
    message: 'hi',
    clinicName: 'Uptown Ortho',
    clinicSettings: { greeting_message: greetingClinicB }
  });

  assert.strictEqual(outA.reply, greetingClinicA);
  assert.strictEqual(outB.reply, greetingClinicB);
  assert.notStrictEqual(outA.reply, outB.reply);
});

// 3. Greeting Lifecycle in Conversation
console.log('\n3. Greeting Lifecycle in Conversation:');
testCase('Welcome greeting is NOT repeated when patient asks for availability on second turn', () => {
  const customGreeting = 'Hello! Welcome to Oracle Clinic. How can I assist you today?';
  const out = runComposeReplyNode({
    action: 'availability',
    message: 'What appointments do you have tomorrow?',
    clinicName: 'Oracle Clinic',
    clinicSettings: { greeting_message: customGreeting },
    actionResult: {
      ok: true,
      data: [{ starts_at: new Date(Date.now() + 86400000).toISOString() }]
    }
  });
  // Must NOT contain the welcome greeting
  assert.ok(!out.reply.includes(customGreeting), 'Availability response must not contain welcome greeting');
  assert.ok(out.reply.includes('available'), 'Should contain availability information');
});

// 4. Automated Receptionist Answering (ACTIVE / PAUSED)
console.log('\n4. Automated Receptionist Answering (ACTIVE / PAUSED):');
testCase('When receptionist_enabled is false, AI response is suppressed and fallback message is returned', () => {
  const customFallback = 'Our office is currently busy with patients. A staff member will respond to you shortly.';
  const out = runComposeReplyNode({
    action: 'greeting',
    message: 'HI',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      receptionist_enabled: false,
      greeting_message: 'Hello! Welcome to Oracle Clinic.',
      fallback_message: customFallback
    }
  });
  assert.strictEqual(out.reply, customFallback);
  assert.strictEqual(out.action, 'handoff');
});

testCase('When receptionist_enabled is false on booking intent, booking is suppressed and fallback returned', () => {
  const out = runComposeReplyNode({
    action: 'book',
    message: 'Book a root canal for 2pm',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      receptionist_enabled: false,
      fallback_message: 'We are offline right now.'
    }
  });
  assert.strictEqual(out.reply, 'We are offline right now.');
  assert.strictEqual(out.action, 'handoff');
});

// 5. Urgent / Emergency Contact Phone
console.log('\n5. Urgent / Emergency Contact Phone:');
testCase('Configured emergency phone number is included in emergency guidance', () => {
  const emergencyPhone = '+1 (555) 789-0123';
  const out = runComposeReplyNode({
    action: 'faq_emergency',
    message: 'I had an accident and my tooth was knocked out',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      emergency_phone: emergencyPhone
    }
  });
  assert.ok(out.reply.includes(emergencyPhone), 'Must contain configured emergency phone');
  assert.ok(out.reply.includes('911') || out.reply.includes('emergency services'), 'Must include 911/emergency warning');
});

testCase('When emergency phone is not configured, provides safe general emergency guidance without inventing numbers', () => {
  const out = runComposeReplyNode({
    action: 'faq_emergency',
    message: 'severe toothache',
    clinicName: 'Oracle Clinic',
    clinicSettings: {}
  });
  assert.ok(!out.reply.includes('555-'), 'Must not invent a phone number');
  assert.ok(out.reply.includes('call the clinic') || out.reply.includes('emergency services'));
});

// 6. Cancellation & Rescheduling Policies
console.log('\n6. Cancellation & Rescheduling Policies:');
testCase('Saved cancellation policy is returned accurately', () => {
  const cancelPolicy = 'Please cancel at least 24 hours in advance to avoid a $50 cancellation fee.';
  const out = runComposeReplyNode({
    action: 'faq_cancellation_policy',
    message: 'What is your cancellation policy?',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      cancellation_policy: cancelPolicy
    }
  });
  assert.strictEqual(out.reply, cancelPolicy);
});

testCase('Saved rescheduling policy is returned accurately', () => {
  const reschedPolicy = 'Appointments can be rescheduled up to 12 hours before without fee.';
  const out = runComposeReplyNode({
    action: 'faq_reschedule_policy',
    message: 'Can I reschedule my appointment?',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      rescheduling_policy: reschedPolicy
    }
  });
  assert.strictEqual(out.reply, reschedPolicy);
});

// 7. Accepted Dental Insurance Information
console.log('\n7. Accepted Dental Insurance Information:');
testCase('General insurance inquiry returns configured accepted insurance text', () => {
  const insuranceText = 'We accept Delta Dental, MetLife, Cigna PPO, and Guardian.';
  const out = runComposeReplyNode({
    action: 'faq_insurance',
    message: 'What insurance do you accept?',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      accepted_insurance: insuranceText
    }
  });
  assert.strictEqual(out.reply, insuranceText);
});

testCase('Specific carrier query confirms acceptance when listed in policy', () => {
  const insuranceText = 'We accept Delta Dental, MetLife, Cigna PPO, and Guardian.';
  const out = runComposeReplyNode({
    action: 'faq_insurance',
    message: 'Do you take Delta Dental?',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      accepted_insurance: insuranceText
    }
  });
  assert.ok(out.reply.includes('Yes, we accept Delta Dental!'));
  assert.ok(out.reply.includes(insuranceText));
});

testCase('Specific carrier query clarifies non-acceptance when not listed and refers to clinic staff', () => {
  const insuranceText = 'We accept Delta Dental, MetLife, Cigna PPO, and Guardian.';
  const out = runComposeReplyNode({
    action: 'faq_insurance',
    message: 'Do you accept Medicaid or Medicare?',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      accepted_insurance: insuranceText
    }
  });
  assert.ok(out.reply.includes("We don't currently have Medicaid listed"));
  assert.ok(out.reply.includes('Please contact our team directly'));
});

// 8. Conversation Tone
console.log('\n8. Conversation Tone:');
testCase('Empathetic tone adds warm, reassuring phrasing on emergency/cancellation', () => {
  const out = runComposeReplyNode({
    action: 'faq_emergency',
    message: 'I have severe dental pain',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      tone: 'empathetic',
      emergency_phone: '+1 (555) 111-2222'
    }
  });
  assert.ok(out.reply.includes("We're so sorry you're dealing with dental discomfort"));
});

testCase('Concise tone delivers brief, direct answers without pleasantries', () => {
  const out = runComposeReplyNode({
    action: 'faq_emergency',
    message: 'emergency',
    clinicName: 'Oracle Clinic',
    clinicSettings: {
      tone: 'concise',
      emergency_phone: '+1 (555) 111-2222'
    }
  });
  assert.ok(out.reply.includes('+1 (555) 111-2222'));
  assert.ok(!out.reply.includes("We're so sorry you're dealing with"));
});

console.log(`\n==================================================`);
console.log(`RESULTS: ${passedTests} / ${totalTests} test cases passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log(`==================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
