const fs = require('fs');
const path = require('path');

const targets = [
  path.resolve(__dirname, '../../../Dental — AI Receptionist (PROPOSED PRODUCTION).json'),
  path.resolve(__dirname, '../../../Dental — AI Receptionist.json'),
  path.resolve(__dirname, '../../../dental-inbound-whatsapp-workflow.json'),
  path.resolve(__dirname, '../../../Dental_AI_Receptionist_SAFE_TEST_COPY.json'),
  path.resolve(__dirname, '../../../dental-test-inbound-workflow.json'),
  path.resolve('C:/Users/ABC/Downloads/Dental — AI Receptionist (PROPOSED PRODUCTION).json'),
  path.resolve('C:/Users/ABC/Downloads/Dental — AI Receptionist.json')
];

for (const targetPath of targets) {
  if (!fs.existsSync(targetPath)) {
    console.log('Skipping missing target:', targetPath);
    continue;
  }

  const content = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

  // 1. Update Extract Intent
  const extractNode = content.nodes.find(n => n.name === 'Extract Intent');
  if (extractNode) {
    let js = extractNode.parameters.jsCode;

    // Check if pure social regex is already present
    if (!js.includes('pureGreetingRegex')) {
      const targetPattern = 'const socialPrefix = /^(hi|hii+|hello|hey|heyy+|good morning|good afternoon|good evening|morning|afternoon|evening|greetings|hiya|howdy)[,!.; ]+/i;';
      const replacementPattern = `// Pure social intent detection fallback (deterministic guard)
const pureGreetingRegex = /^(hi|hii+|hello|hey|heyy+|good morning|good afternoon|good evening|morning|afternoon|evening|greetings|hiya|howdy)[!.]*$/i;
const pureThanksRegex = /^(thanks|thank you|thx|thank you so much)[!.]*$/i;
const pureGoodbyeRegex = /^(bye|goodbye|see you|cya|have a good day)[!.]*$/i;

if (intent === 'clarify') {
  const trimmed = message.trim();
  if (pureGreetingRegex.test(trimmed)) {
    intent = 'greeting';
    semanticStatus = 'ok';
  } else if (pureThanksRegex.test(trimmed)) {
    intent = 'thanks';
    semanticStatus = 'ok';
  } else if (pureGoodbyeRegex.test(trimmed)) {
    intent = 'goodbye';
    semanticStatus = 'ok';
  }
}

const socialPrefix = /^(hi|hii+|hello|hey|heyy+|good morning|good afternoon|good evening|morning|afternoon|evening|greetings|hiya|howdy)[,!.; ]+/i;`;

      if (js.includes(targetPattern)) {
        js = js.replace(targetPattern, replacementPattern);
      }
    }

    if (!js.includes('is_new_conversation:')) {
      const returnTarget = 'conversation_id: conv.conversation_id ?? dup.conversation_id ?? null,';
      const returnReplacement = `conversation_id: conv.conversation_id ?? dup.conversation_id ?? null,
    is_new_conversation: conv.existing === false,
    conversation_existing: conv.existing === true,`;
      if (js.includes(returnTarget)) {
        js = js.replace(returnTarget, returnReplacement);
      }
    }

    extractNode.parameters.jsCode = js;
    console.log(`[${path.basename(targetPath)}] Updated Extract Intent`);
  }

  // 2. Update Resolve Slots
  const resolveSlotsNode = content.nodes.find(n => n.name === 'Resolve Slots');
  if (resolveSlotsNode) {
    let js = resolveSlotsNode.parameters.jsCode;

    const oldActionSection = `let action = ex.intent;

if (
  ['book', 'cancel', 'reschedule', 'availability', 'lookup']
    .includes(action) &&
  missing.length > 0
) {
  action = 'clarify';
}

if (
  ['cancel', 'reschedule'].includes(ex.intent) &&
  !s.appointment_id &&
  s.confirmation_code &&
  missing.length === 0
) {
  action = 'lookup_then_' + ex.intent;
}`;

    const newActionSection = `let action = ex.intent;
const settings = ctx.settings ?? {};
const nested = (settings.receptionist && typeof settings.receptionist === 'object') ? settings.receptionist : {};
const receptionistEnabled = settings.receptionist_enabled !== false && settings.enabled !== false && nested.enabled !== false;

if (!receptionistEnabled) {
  action = 'handoff';
} else if (
  ['book', 'cancel', 'reschedule', 'availability', 'lookup']
    .includes(action) &&
  missing.length > 0
) {
  action = 'clarify';
}

if (
  receptionistEnabled &&
  ['cancel', 'reschedule'].includes(ex.intent) &&
  !s.appointment_id &&
  s.confirmation_code &&
  missing.length === 0
) {
  action = 'lookup_then_' + ex.intent;
}`;

    if (js.includes(oldActionSection)) {
      js = js.replace(oldActionSection, newActionSection);
    } else {
      // Look for previous patched version or replace directly
      const actIdx = js.indexOf('let action = ex.intent;');
      if (actIdx !== -1) {
        const nextPart = js.slice(actIdx);
        const endPartIdx = nextPart.indexOf('// --------------------------------------------------');
        if (endPartIdx !== -1) {
          js = js.slice(0, actIdx) + newActionSection + '\n\n' + nextPart.slice(endPartIdx);
        }
      }
    }

    resolveSlotsNode.parameters.jsCode = js;
    console.log(`[${path.basename(targetPath)}] Updated Resolve Slots`);
  }

  // 3. Update Compose Reply
  const composeReplyNode = content.nodes.find(n => n.name === 'Compose Reply');
  if (composeReplyNode) {
    let js = composeReplyNode.parameters.jsCode;

    // Check paused receptionist guard at start of settings
    const settingsTargetRegex = /const settings = ex\.clinic\?\.settings \?\? \{\};[\s\S]*?const receptionistEnabled =[\s\S]*?\}\];\n\}/;
    const standardSettingsTarget = `const settings = ex.clinic?.settings ?? {};
const settingVal = (...keys) => {
  for (const k of keys) {
    if (settings[k] !== undefined && settings[k] !== null && settings[k] !== '') return settings[k];
  }
  return null;
};`;

    const newSettingsBlock = `const settings = ex.clinic?.settings ?? {};
const nested = (settings.receptionist && typeof settings.receptionist === 'object') ? settings.receptionist : {};

const settingVal = (...keys) => {
  for (const k of keys) {
    if (settings[k] !== undefined && settings[k] !== null && settings[k] !== '') return settings[k];
    if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') return nested[k];
  }
  return null;
};

const receptionistEnabled = settings.receptionist_enabled !== false && settings.enabled !== false && nested.enabled !== false;
if (!receptionistEnabled) {
  const fallbackMsg = settingVal('fallback_message', 'fallbackMessage');
  const pausedReply = (fallbackMsg && String(fallbackMsg).trim().length > 0)
    ? String(fallbackMsg)
    : "I am connecting you with our human team right now. Please hold on.";
  return [{
    json: {
      ok: true,
      code: 'OK',
      reply: pausedReply,
      reply_b64: Buffer.from(pausedReply, 'utf8').toString('base64'),
      action: 'handoff',
      clinic_id: ex.clinic_id,
      conversation_id: ex.conversation_id,
      provider_event_id: ex.provider_event_id,
      event_id: ex.event_id,
      patient_id: ex.patient_id,
      channel: ex.channel
    }
  }];
}`;

    if (settingsTargetRegex.test(js)) {
      js = js.replace(settingsTargetRegex, newSettingsBlock);
    } else if (js.includes(standardSettingsTarget)) {
      js = js.replace(standardSettingsTarget, newSettingsBlock);
    }

    // Replace greeting case
    const oldGreeting = `  case 'greeting':
    reply = /good morning/i.test(ex.message ?? '') ? "Good morning! How can I help you today?"
      : /good afternoon/i.test(ex.message ?? '') ? "Good afternoon! How can I help you today?"
      : /good evening/i.test(ex.message ?? '') ? "Good evening! How can I help you today?"
      : "Hi! How can I help you today?";
    break;`;

    const newGreeting = `  case 'greeting': {
    const customGreeting = settingVal('greeting_message', 'welcome_message', 'welcomeMessage');
    reply = (customGreeting && String(customGreeting).trim().length > 0)
      ? String(customGreeting)
      : "Hello! Welcome to " + name + ". How can I assist you today?";
    break;
  }

  case 'handoff': {
    const fallbackMsg = settingVal('fallback_message', 'fallbackMessage');
    reply = (fallbackMsg && String(fallbackMsg).trim().length > 0)
      ? String(fallbackMsg)
      : "I am connecting you with our human team right now. Please hold on.";
    break;
  }`;

    if (js.includes(oldGreeting)) {
      js = js.replace(oldGreeting, newGreeting);
    }

    // Replace faq_emergency case
    const oldEmergency = `  case 'faq_emergency': {
    const em = settingVal('emergency_guidance', 'emergency');
    reply = em ?? 'If you are experiencing a dental emergency, please call the clinic right away. If it is life-threatening, please call emergency services first.';
    break;
  }`;

    const newEmergency = `  case 'faq_emergency': {
    const emGuidance = settingVal('emergency_guidance', 'emergency');
    const emPhone = settingVal('emergency_phone', 'emergencyPhone');
    if (emPhone && String(emPhone).trim().length > 0) {
      const cleanPhone = String(emPhone).trim();
      if (emGuidance && String(emGuidance).trim().length > 0) {
        reply = String(emGuidance).trim() + " For urgent dental emergencies, please call our emergency line at " + cleanPhone + ". If you are experiencing a life-threatening medical emergency, please call 911 right away.";
      } else {
        reply = "If you are experiencing a dental emergency, please call our clinic immediately at " + cleanPhone + ". If you are experiencing a life-threatening medical emergency, please call emergency services (911) right away.";
      }
    } else if (emGuidance && String(emGuidance).trim().length > 0) {
      reply = String(emGuidance).trim();
    } else {
      reply = "If you are experiencing a dental emergency, please call the clinic right away. If it is life-threatening, please call emergency services first.";
    }
    break;
  }`;

    if (js.includes(oldEmergency)) {
      js = js.replace(oldEmergency, newEmergency);
    }

    // Replace cancellation policy
    const oldCancel = `  case 'faq_cancellation_policy': {
    const pol = settingVal('cancellation_policy');
    reply = pol ?? 'You can cancel your appointment through this chat using your confirmation code, or by contacting the clinic directly.';
    break;
  }`;

    const newCancel = `  case 'faq_cancellation_policy': {
    const pol = settingVal('cancellation_policy', 'cancellationPolicy');
    reply = (pol && String(pol).trim().length > 0)
      ? String(pol)
      : "You can cancel your appointment through this chat using your confirmation code, or by contacting the clinic directly.";
    break;
  }`;

    if (js.includes(oldCancel)) {
      js = js.replace(oldCancel, newCancel);
    }

    // Replace reschedule policy
    const oldReschedule = `  case 'faq_reschedule_policy': {
    const pol = settingVal('rescheduling_policy', 'reschedule_policy');
    reply = pol ?? 'You can reschedule your appointment through this chat using your confirmation code, or by contacting the clinic directly.';
    break;
  }`;

    const newReschedule = `  case 'faq_reschedule_policy': {
    const pol = settingVal('rescheduling_policy', 'reschedule_policy', 'cancellation_policy', 'cancellationPolicy');
    reply = (pol && String(pol).trim().length > 0)
      ? String(pol)
      : "You can reschedule your appointment through this chat using your confirmation code, or by contacting the clinic directly.";
    break;
  }`;

    if (js.includes(oldReschedule)) {
      js = js.replace(oldReschedule, newReschedule);
    }

    // Replace insurance case
    const oldInsurance = `  case 'faq_insurance': {
    const ins = settingVal('insurance', 'insurance_info', 'accepted_insurance');
    reply = ins ?? "I don't have insurance information on file. The clinic can check your specific plan for you.";
    break;
  }`;

    const newInsurance = `  case 'faq_insurance': {
    const ins = settingVal('accepted_insurance', 'acceptedInsurance', 'insurance', 'insurance_info');
    if (ins && String(ins).trim().length > 0) {
      const insText = String(ins).trim();
      const msgText = String(ex.message ?? '').toLowerCase();
      const knownPlans = [
        'delta dental', 'delta', 'metlife', 'cigna', 'guardian', 'aetna',
        'blue cross', 'blue shield', 'anthem', 'humana', 'united healthcare',
        'unitedhealthcare', 'medicaid', 'medicare', 'careington', 'geha',
        'ameritas', 'sun life', 'principal'
      ];
      const matchedPlan = knownPlans.find(p => msgText.includes(p));
      if (matchedPlan) {
        const planInPolicy = insText.toLowerCase().includes(matchedPlan);
        const capName = matchedPlan.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (planInPolicy) {
          reply = "Yes, we accept " + capName + "! " + insText;
        } else {
          reply = "We don't currently have " + capName + " listed among our accepted insurance plans. " + insText + " Please contact our team directly to verify coverage for your specific policy.";
        }
      } else {
        reply = insText;
      }
    } else {
      reply = "I don't have insurance information on file. The clinic can check your specific plan for you.";
    }
    break;
  }`;

    if (js.includes(oldInsurance)) {
      js = js.replace(oldInsurance, newInsurance);
    }

    // Add applyTone before return
    if (!js.includes('function applyTone(')) {
      const oldReturnTarget = `if (INFO_INTENTS.has(ex.action) && ex.action !== 'greeting') {
  reply = withGreeting(reply);
}

return [{`;

      const newReturnTarget = `if (INFO_INTENTS.has(ex.action) && ex.action !== 'greeting') {
  reply = withGreeting(reply);
}

function applyTone(text, currentTone, currentAction) {
  if (!text || currentAction === 'greeting' || currentAction === 'handoff') return text;
  if (!currentTone || currentTone === 'professional') return text;
  
  if (currentTone === 'concise') {
    let s = text;
    s = s.replace(/^(Happy to help — |Of course[.] |Certainly[.] |You're very welcome! |I'd be happy to help with that[.] )/i, '');
    s = s.replace(/Which time would you prefer\\?/i, 'Which time works for you?');
    s = s.replace(/Would you like me to find another available time\\?/i, 'Check another time?');
    s = s.replace(/Would you like me to book it\\?/i, 'Book this?');
    s = s.replace(/Done — your appointment has been cancelled[.]/i, 'Your appointment has been cancelled.');
    s = s.replace(/Done — I've moved your appointment to /i, 'Appointment moved to ');
    return s.trim();
  }
  
  if (currentTone === 'empathetic') {
    if (currentAction === 'book' && text.includes("You're all set")) {
      return "You're all set! We look forward to seeing you and taking gentle care of you. " + text;
    }
    if (currentAction === 'cancel') {
      return text + " We hope everything is okay, and we're here whenever you're ready to reschedule.";
    }
    if (currentAction === 'faq_emergency') {
      return "We're so sorry you're dealing with dental discomfort. " + text;
    }
    if (currentAction === 'clarify' && text.startsWith('Happy to help')) {
      return "We're here to take great care of you. " + text;
    }
    return text;
  }
  
  return text;
}

const tone = (settingVal('tone') ?? 'professional').toLowerCase();
reply = applyTone(reply, tone, ex.action);

return [{`;

      if (js.includes(oldReturnTarget)) {
        js = js.replace(oldReturnTarget, newReturnTarget);
      }
    }

    composeReplyNode.parameters.jsCode = js;
    console.log(`[${path.basename(targetPath)}] Updated Compose Reply`);
  }

  fs.writeFileSync(targetPath, JSON.stringify(content, null, 2), 'utf8');
  console.log(`[${path.basename(targetPath)}] Saved successfully.`);
}
