/*
  Marathon Crew Portal backend
  Wheee Sdn. Bhd. and Woots Event PLT

  Google Apps Script web app. Paste this whole file into Code.gs of an
  Apps Script project that is bound to the crew Google Sheet, run setup()
  once, then deploy as a Web app (Execute as: Me, Who has access: Anyone).
*/

// Change this before you run setup() the first time. It is the password for the Admin page.
const INITIAL_ADMIN_KEY = 'CHANGE_ME_BEFORE_SETUP';

const CREW_ID_PREFIX = 'WC';
const SENDER_NAME = 'Wheee Sdn. Bhd. and Woots Event PLT';
const REPLY_TO = 'hello@wheeepnp.com';
const PORTAL_TZ = 'Asia/Kuala_Lumpur';
const QR_PREFIX = 'WC1:';
const SCAN_TYPES = { CheckIn: 'Check in', RollCall: 'Roll call 1', RollCall2: 'Roll call 2', RollCall3: 'Roll call 3', CheckOut: 'Check out' };
// Each roll call counts once per day. 'RollCall' keeps its old key so earlier scans still count as roll call 1.
const ROLL_CALLS = ['RollCall', 'RollCall2', 'RollCall3'];
const STATUSES = ['Published', 'Paused', 'Deleted'];
const LANGUAGE_ROWS = ['Malay', 'English', 'Chinese'];
const LANGUAGE_COLUMNS = ['1st Choice', '2nd Choice', '3rd Choice', 'Not at all'];
const GENDERS = ['Male', 'Female', 'Prefer not to say'];
const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const DIETARY_OPTIONS = ['None (Can consume Non-Vegetarian and Halal food)', 'Vegetarian (Can consume five pungent plants)'];
const MAX_FILE_CHARS = 14000000; // about 10MB once decoded
const MAX_IC_FILES = 2;
const NATIONALITY_OPTIONS = ['Malaysian'];
const BANKS = ['AFFIN BANK BERHAD', 'BANK PERTANIAN MALAYSIA BHD', 'ALLIANCE BANK BERHAD', 'AL-RAJHI BANK', 'AMBANK BERHAD',
  'BANK ISLAM BERHAD', 'BANK OF AMERICA', 'BK OF CHINA (M) BHD', 'BANK RAKYAT MALAYSIA', 'BNP PARIBAS MALAYSIA BHD',
  'BANK SIMPANAN', 'CIMB BANK BERHAD', 'CITIBANK BERHAD', 'DEUTSCHE BANK(M) BHD', 'HONG LEONG BANK', 'HSBC (M) BERHAD',
  'IND & COM BANK OF CHINA (M)BHD', 'J.P. MORGAN CHASE BANK BHD', 'KUWAIT FINANCE HOUSE', 'MALAYAN BANKING BERHAD',
  'MIZUHO CORPORATE BANK (M) BHD', "BANK MUAMALAT (M'SIA)", 'BNK OF TOKYO (M) BHD', "OCBC BANK (M'SIA) BHD",
  'PUBLIC BANK BERHAD', 'RHB BANK', 'SUMITOMO MITSUI BANK', 'STANDARD CHARTERED', 'UNITED OVERSEAS BANK BERHAD'];

const SHEETS = {
  Events: ['EventID', 'Name', 'Location', 'Description', 'Status', 'CreatedAt', 'UpdatedAt', 'ScannerPIN'],
  Phases: ['PhaseID', 'EventID', 'Order', 'JobScope', 'Pax', 'DateText', 'TimeText', 'CallTime', 'Venue', 'Wages', 'Conflicts', 'StartDate', 'EndDate', 'WhatsApp'],
  Crew: ['CrewID', 'FullName', 'PreferredName', 'IDNumber', 'IDKey', 'Nationality', 'Email', 'Phone', 'Gender',
    'Languages', 'ShirtSize', 'HealthCondition', 'Dietary',
    'JobExperience', 'BankName', 'BankAccount', 'BankHolder', 'PhotoLink', 'ICCopyLink',
    'SignedVersion', 'SignedAgreementLink', 'SignedAt', 'CreatedAt', 'UpdatedAt', 'QRToken', 'EmailStatus'],
  Registrations: ['RegID', 'Timestamp', 'CrewID', 'FullName', 'Phone', 'EventID', 'EventName', 'PhaseID',
    'JobScope', 'DateText', 'Wages', 'Status', 'JobsBefore', 'ReplacementOf', 'ReplacedBy', 'SeatID', 'Days', 'DaysCount'],
  Attendance: ['ScanID', 'Timestamp', 'EventID', 'Day', 'CrewID', 'FullName', 'Type', 'Scanner'],
  Settings: ['Key', 'Value']
};

const DEFAULT_AGREEMENT_INTRO = 'Please review the Event Crew Agreement below, then confirm each statement and sign at the bottom.';
const DEFAULT_ACKNOWLEDGEMENTS = [
  'I acknowledge that I have read, understood, and agree to comply with all terms and conditions set out in this Event Crew Agreement.',
  'I acknowledge and agree to commit to this event and to comply with the schedule, duties, and instructions given by the Event Organizer, Woots, and/or Wheee.',
  'I agree to perform my duties professionally and responsibly and to abide by the Code of Conduct set out in this agreement.',
  'I confirm that all information provided in this form is true, accurate, and complete to the best of my knowledge.'
];

const FILE_FOLDERS = { photo: 'Profile Photos', ic: 'IC and Passport Copies', agreement: 'Signed Agreements', attendance: 'Attendance Lists' };

/* ---------- Routing ---------- */

const PUBLIC_ROUTES = {
  ping: function () { return 'ok'; },
  getOpenEvents: getOpenEvents_,
  getAgreement: getAgreement_,
  checkId: checkId_,
  findReplacement: findReplacement_,
  verifyCrew: verifyCrew_,
  submit: submit_,
  scanLogin: scanLogin_,
  scan: scan_
};

const ADMIN_ROUTES = {
  adminLogin: function () { return true; },
  adminListEvents: adminListEvents_,
  adminSaveEvent: adminSaveEvent_,
  adminSetStatus: adminSetStatus_,
  adminListRegistrations: adminListRegistrations_,
  adminCancelRegistration: adminCancelRegistration_,
  adminListCrew: adminListCrew_,
  adminSaveAgreement: adminSaveAgreement_,
  adminResendEmail: adminResendEmail_,
  adminAttendance: adminAttendance_,
  adminGenerateAttendance: adminGenerateAttendance_
};

function doGet() {
  return json_({ ok: true, data: 'Marathon Crew Portal API is running.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid request.' });
  }
  try {
    const action = String(req.action || '');
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, action)) {
      return json_({ ok: true, data: PUBLIC_ROUTES[action](req) });
    }
    if (Object.prototype.hasOwnProperty.call(ADMIN_ROUTES, action)) {
      checkAdmin_(req.key);
      return json_({ ok: true, data: ADMIN_ROUTES[action](req) });
    }
    throw new Error('Unknown action.');
  } catch (err) {
    return json_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkAdmin_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!real) throw new Error('Admin key is not set. Run setup in Apps Script first.');
  if (String(key || '') !== real) throw new Error('Wrong admin key.');
}

/* ---------- One time setup ---------- */

function setup() {
  // Creates any missing tab and refreshes every header row (safe to run again after an update).
  Object.keys(SHEETS).forEach(function (name) {
    sheet_(name).getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', INITIAL_ADMIN_KEY);
  if (!getSetting_('agreementVersion')) setSetting_('agreementVersion', 1);
  if (!getSetting_('agreementIntro')) setSetting_('agreementIntro', DEFAULT_AGREEMENT_INTRO);
  if (!getSetting_('agreementAcks')) setSetting_('agreementAcks', JSON.stringify(DEFAULT_ACKNOWLEDGEMENTS));
  Object.keys(FILE_FOLDERS).forEach(function (k) { subFolder_(FILE_FOLDERS[k]); });
  // Checks the inbox every hour for bounced emails and marks those crew emails red.
  const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkBounces'; });
  if (!hasTrigger) ScriptApp.newTrigger('checkBounces').timeBased().everyHours(1).create();
  Logger.log('Setup complete. Admin key: ' + props.getProperty('ADMIN_KEY'));
}

// To change the admin key later: type the new key below, then run this function once.
function changeAdminKey() {
  const newKey = 'TYPE_NEW_KEY_HERE';
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', newKey);
  Logger.log('Admin key changed.');
}

/* ---------- Sheet helpers ---------- */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const book = ss_();
  let sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const heads = SHEETS[name];
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, heads.length).getValues();
  return vals.map(function (r, i) {
    const o = { _row: i + 2 };
    heads.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

// Keeps phone numbers, IC numbers and times as plain text, and blocks formula injection.
function safeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@0-9]/.test(v)) return "'" + v;
  return v;
}

function toRow_(name, obj) {
  return SHEETS[name].map(function (h) { return safeCell_(obj[h]); });
}

function append_(name, obj) {
  sheet_(name).appendRow(toRow_(name, obj));
}

function update_(name, obj) {
  const row = toRow_(name, obj);
  sheet_(name).getRange(obj._row, 1, 1, row.length).setValues([row]);
}

function getSetting_(key) {
  const row = readAll_('Settings').filter(function (r) { return str_(r.Key) === key; })[0];
  return row ? row.Value : '';
}

function setSetting_(key, value) {
  const row = readAll_('Settings').filter(function (r) { return str_(r.Key) === key; })[0];
  if (row) { row.Value = value; update_('Settings', row); }
  else append_('Settings', { Key: key, Value: value });
}

/* ---------- Drive files ---------- */

function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FILES_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ } }
  const f = DriveApp.createFolder('Marathon Crew Files');
  props.setProperty('FILES_FOLDER_ID', f.getId());
  return f;
}

function subFolder_(name) {
  const root = rootFolder_();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// kind: 'photo' and 'ic' (JPG, HEIC, PNG or PDF), 'agreement' (PDF only)
function saveFile_(dataUrl, kind, baseName, label) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  const head = comma > 0 ? s.slice(0, comma) : '';
  const m = /^data:([a-zA-Z0-9.+\/-]+);base64$/.exec(head);
  if (!m) throw new Error('Please attach your ' + label + '.');
  const mime = m[1].toLowerCase();
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
  const isPdf = mime === 'application/pdf';
  if ((kind === 'agreement' && !isPdf) || (kind !== 'agreement' && !EXT[mime])) {
    throw new Error('Your ' + label + ' must be a JPG, HEIC, PNG or PDF file.');
  }
  if (s.length - comma > MAX_FILE_CHARS) throw new Error('Your ' + label + ' is over 10MB. Please choose a smaller file.');
  const ext = EXT[mime];
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyyMMdd_HHmmss');
  const blob = Utilities.newBlob(Utilities.base64Decode(s.slice(comma + 1)), mime, baseName + '_' + stamp + '.' + ext);
  return subFolder_(FILE_FOLDERS[kind]).createFile(blob).getUrl();
}

/* ---------- Small utilities ---------- */

let ID_SEQ_ = 0;

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function clip_(v, n) { return str_(v).slice(0, n || 500); }
function idKey_(v) { return str_(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function digits_(v) { return str_(v).replace(/\D/g, ''); }
function list_(v) { return str_(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
function newId_(prefix) {
  ID_SEQ_ = (ID_SEQ_ + 1) % 1296;
  return prefix + Date.now().toString(36).toUpperCase() + ID_SEQ_.toString(36).toUpperCase().padStart(2, '0') +
    Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
}
function fileSafe_(v) { return str_(v).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'crew'; }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('The portal is busy. Please try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// A slot (seat) is counted once, even when some of its days are covered by a replacement crew.
function confirmedCounts_(regs) {
  const seats = {};
  regs.forEach(function (r) {
    if (str_(r.Status) !== 'Confirmed') return;
    const k = str_(r.PhaseID);
    seats[k] = seats[k] || {};
    seats[k][str_(r.SeatID) || str_(r.RegID)] = true;
  });
  const c = {};
  Object.keys(seats).forEach(function (k) { c[k] = Object.keys(seats[k]).length; });
  return c;
}

function jobsByCrew_(regs) {
  const c = {};
  regs.forEach(function (r) {
    if (str_(r.Status) === 'Confirmed') { const k = str_(r.CrewID); c[k] = (c[k] || 0) + 1; }
  });
  return c;
}

function heldBy_(regs, crewId) {
  return regs.filter(function (r) {
    return str_(r.CrewID) === str_(crewId) && str_(r.Status) === 'Confirmed';
  }).map(function (r) { return str_(r.PhaseID); });
}

const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_ = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Dates are kept as yyyy-mm-dd text. A date typed into the sheet by hand is converted too.
function isoDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str_(v));
  return m ? m[0] : '';
}

function dayLabel_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 'All days';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() + ' ' + MONTHS_[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' (' + WEEKDAYS_[d.getUTCDay()] + ')';
}

// Every working day of a job scope, from its start date to its end date.
function phaseDays_(p) {
  const a = isoDate_(p.StartDate), b = isoDate_(p.EndDate) || a;
  if (!a) return [];
  const out = [];
  const d = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z');
  while (d <= end && out.length < 62) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// The days a registration row covers. Older rows without days cover the whole job scope.
function rowDays_(r, p) {
  const own = list_(r.Days);
  if (own.length) return own;
  const all = p ? phaseDays_(p) : [];
  return all.length ? all : ['ALL'];
}

function phaseOut_(p, counts) {
  const pax = Number(p.Pax) || 0;
  const filled = counts[str_(p.PhaseID)] || 0;
  return {
    phaseId: str_(p.PhaseID), order: Number(p.Order) || 0, jobScope: str_(p.JobScope),
    pax: pax, filled: filled, remaining: Math.max(0, pax - filled),
    dateText: str_(p.DateText), timeText: str_(p.TimeText), callTime: str_(p.CallTime),
    venue: str_(p.Venue), wages: str_(p.Wages), conflicts: list_(p.Conflicts),
    startDate: isoDate_(p.StartDate), endDate: isoDate_(p.EndDate), days: phaseDays_(p),
    whatsapp: str_(p.WhatsApp)
  };
}

function phasesFor_(phases, eventId, counts) {
  return phases.filter(function (p) { return str_(p.EventID) === str_(eventId); })
    .map(function (p) { return phaseOut_(p, counts); })
    .sort(function (a, b) { return a.order - b.order; });
}

/* ---------- Public: events and agreement ---------- */

function getOpenEvents_() {
  const counts = confirmedCounts_(readAll_('Registrations'));
  const phases = readAll_('Phases');
  return readAll_('Events')
    .filter(function (ev) { return str_(ev.Status) === 'Published'; })
    .map(function (ev) {
      const ph = phasesFor_(phases, ev.EventID, counts);
      return {
        eventId: str_(ev.EventID), name: str_(ev.Name), location: str_(ev.Location),
        description: str_(ev.Description), phases: ph,
        // A full event stays listed so crew can still replace someone in it.
        full: !ph.some(function (p) { return p.remaining > 0; })
      };
    })
    .filter(function (ev) { return ev.phases.length > 0; });
}

function getAgreement_() {
  let acks = [];
  try { acks = JSON.parse(str_(getSetting_('agreementAcks')) || '[]'); } catch (e) { acks = []; }
  if (!Array.isArray(acks) || !acks.length) acks = DEFAULT_ACKNOWLEDGEMENTS;
  return {
    version: Number(getSetting_('agreementVersion')) || 1,
    intro: str_(getSetting_('agreementIntro')) || DEFAULT_AGREEMENT_INTRO,
    acknowledgements: acks
  };
}

/* ---------- Public: crew ---------- */

function last4_(v) { return digits_(v).slice(-4); }
function nameKey_(v) { return str_(v).toUpperCase().replace(/\s+/g, ' '); }

// Returning crew sign in with their IC or passport number plus the last 4 digits of their phone.
// To change a crew member's phone, edit the Phone cell on the Crew tab of the Google Sheet.
function findVerifiedCrew_(idNumber, phoneLast4) {
  const key = idKey_(idNumber);
  const p4 = digits_(phoneLast4);
  if (!key || p4.length !== 4) throw new Error('Please enter your IC or passport number and the last 4 digits of your phone number.');
  const crew = readAll_('Crew').filter(function (c) {
    return str_(c.IDKey) === key && last4_(c.Phone) === p4;
  })[0];
  if (!crew) throw new Error('Your IC or passport number and phone digits do not match our records. Please check and try again, or contact us if you have changed your phone number.');
  return crew;
}

function checkId_(req) {
  const key = idKey_(req.idNumber);
  return { registered: !!key && readAll_('Crew').some(function (c) { return str_(c.IDKey) === key; }) };
}

function verifyCrew_(req) {
  const crew = findVerifiedCrew_(req.idNumber, req.phoneLast4);
  const ag = getAgreement_();
  const held = heldBy_(readAll_('Registrations'), crew.CrewID);
  return {
    fullName: str_(crew.FullName),
    needsResign: Number(crew.SignedVersion) !== ag.version,
    held: held, jobsDone: held.length
  };
}

function choiceOrOther_(v, options, label) {
  const s = clip_(v, 200);
  if (options.indexOf(s) >= 0) return s;
  if (/^Other: \S/.test(s)) return s;
  throw new Error('Please choose your ' + label + '.');
}

function cleanPhone_(v) {
  const p = clip_(v, 30);
  if (!/^\+[1-9]\d{6,14}$/.test(p.replace(/[\s()-]/g, ''))) {
    throw new Error('Please enter your phone number with the country code, for example +60 12 345 6789.');
  }
  return p;
}

function cleanEmail_(v) {
  const e = clip_(v, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Please enter a valid email address.');
  return e;
}

function cleanLanguages_(langs) {
  const l = langs || {};
  const parts = LANGUAGE_ROWS.map(function (row) {
    const v = str_(l[row]);
    if (LANGUAGE_COLUMNS.indexOf(v) < 0) throw new Error('Please rank every language under Preferred Language.');
    return row + ': ' + v;
  });
  if (LANGUAGE_ROWS.every(function (row) { return str_(l[row]) === 'Not at all'; })) {
    throw new Error('Please choose at least one language you can speak.');
  }
  return parts.join(', ');
}

function cleanDetails_(d) {
  const out = {
    FullName: clip_(d.fullName, 120),
    PreferredName: clip_(d.preferredName, 60),
    IDNumber: clip_(d.idNumber, 40).toUpperCase(),
    JobExperience: clip_(d.jobExperience, 1500),
    BankHolder: clip_(d.bankHolder, 120)
  };
  out.IDKey = idKey_(out.IDNumber);
  out.Nationality = choiceOrOther_(d.nationality, NATIONALITY_OPTIONS, 'nationality');
  if (!out.FullName || !/^[A-Za-zÀ-ɏ' .\/@-]+$/.test(out.FullName)) {
    throw new Error('Please enter your full name as per your IC or passport.');
  }
  if (out.Nationality === 'Malaysian') {
    if (!/^\d{12}$/.test(out.IDNumber)) throw new Error('Please enter your 12 digit IC number, numbers only without dashes.');
  } else if (!/^[A-Z0-9]{5,20}$/.test(out.IDNumber)) {
    throw new Error('Please enter your passport number using letters and numbers only, without dashes or spaces.');
  }
  out.Email = cleanEmail_(d.email);
  out.Phone = cleanPhone_(d.phone);
  if (GENDERS.indexOf(str_(d.gender)) < 0) throw new Error('Please choose your gender.');
  out.Gender = str_(d.gender);
  out.Languages = cleanLanguages_(d.languages);
  if (!out.JobExperience) throw new Error('Please fill in your job or event experience, or put N/A if you have none.');
  out.ShirtSize = choiceOrOther_(d.shirtSize, SHIRT_SIZES, 'T shirt size');
  out.HealthCondition = choiceOrOther_(d.healthCondition, ['Good'], 'health or medical condition');
  out.Dietary = choiceOrOther_(d.dietary, DIETARY_OPTIONS, 'dietary restrictions');
  out.BankName = choiceOrOther_(d.bankName, BANKS, 'bank');
  out.BankAccount = cleanAccount_(d.bankAccount);
  if (!out.BankHolder) throw new Error("Please fill in the account holder's name.");
  return out;
}

function cleanAccount_(v) {
  const a = clip_(v, 40);
  if (!/^\d{5,20}$/.test(a)) throw new Error('Please enter your bank account number using numbers only, without dashes or spaces.');
  return a;
}

function cleanUpdates_(u) {
  const out = {};
  if (str_(u.phone)) out.Phone = cleanPhone_(u.phone);
  if (str_(u.email)) out.Email = cleanEmail_(u.email);
  if (str_(u.bankName)) out.BankName = choiceOrOther_(u.bankName, BANKS, 'bank');
  if (str_(u.bankAccount)) out.BankAccount = cleanAccount_(u.bankAccount);
  if (str_(u.bankHolder)) out.BankHolder = clip_(u.bankHolder, 120);
  return out;
}

function requireAgreement_(req, ag) {
  if (!req.agreed) throw new Error('Please confirm every statement under the Event Crew Agreement.');
  if (Number(req.agreementVersion) !== ag.version) {
    throw new Error('The agreement was updated while you were filling in the form. Please refresh the page and sign the latest version.');
  }
  if (String(req.signedAgreementPdf || '').indexOf('data:application/pdf;base64,') !== 0) {
    throw new Error('Please sign the agreement before submitting.');
  }
}

// Finds the confirmed registrations of the crew member being replaced in this event,
// matched by full name (or preferred name) and the last 4 digits of their phone.
function findReplaced_(eventId, rep, regs, selfCrewId) {
  const name = nameKey_(rep && rep.fullName);
  const p4 = digits_(rep && rep.phoneLast4);
  if (!name || p4.length !== 4) {
    throw new Error('Please enter the full name of the crew you are replacing and the last 4 digits of their phone number.');
  }
  const crewMap = {};
  readAll_('Crew').forEach(function (c) { crewMap[str_(c.CrewID)] = c; });
  const rows = regs.filter(function (r) {
    if (str_(r.EventID) !== str_(eventId) || str_(r.Status) !== 'Confirmed') return false;
    const c = crewMap[str_(r.CrewID)] || {};
    return last4_(c.Phone || r.Phone) === p4 &&
      (nameKey_(c.FullName || r.FullName) === name || (c.PreferredName && nameKey_(c.PreferredName) === name));
  });
  if (!rows.length) {
    throw new Error('We could not find a crew member with that name and phone number registered for this event. Please check the spelling of their full name and the last 4 digits of their phone.');
  }
  if (selfCrewId && str_(rows[0].CrewID) === str_(selfCrewId)) throw new Error('You cannot replace yourself.');
  return { crew: crewMap[str_(rows[0].CrewID)] || {}, rows: rows };
}

function phaseMap_(eventId) {
  const map = {};
  readAll_('Phases').forEach(function (p) { if (str_(p.EventID) === str_(eventId)) map[str_(p.PhaseID)] = p; });
  return map;
}

// Public: after the crew enters the name and phone digits, list the job scopes and days they can take over.
function findReplacement_(req) {
  const found = findReplaced_(req.eventId, req, readAll_('Registrations'), '');
  const map = phaseMap_(req.eventId);
  return {
    fullName: str_(found.crew.FullName || found.rows[0].FullName),
    options: found.rows.map(function (r) {
      const p = map[str_(r.PhaseID)] || {};
      return {
        regId: str_(r.RegID), jobScope: str_(r.JobScope),
        days: rowDays_(r, p).map(function (d) { return { day: d, label: dayLabel_(d) }; })
      };
    })
  };
}

// Works out exactly which registration rows and days the new crew is taking over.
function planReplacement_(eventId, rep, regs, selfCrewId) {
  const found = findReplaced_(eventId, rep, regs, selfCrewId);
  const map = phaseMap_(eventId);
  const picks = Array.isArray(rep.picks) ? rep.picks : [];
  if (!picks.length) throw new Error('Please choose the job scope and day you are replacing.');
  const items = [];
  found.rows.forEach(function (r) {
    const p = map[str_(r.PhaseID)];
    const avail = rowDays_(r, p);
    const days = [];
    picks.forEach(function (k) {
      if (str_(k.regId) === str_(r.RegID) && avail.indexOf(str_(k.day)) >= 0 && days.indexOf(str_(k.day)) < 0) days.push(str_(k.day));
    });
    if (days.length) items.push({ row: r, phase: p, days: avail.filter(function (d) { return days.indexOf(d) >= 0; }), avail: avail });
  });
  const valid = items.reduce(function (n, it) { return n + it.days.length; }, 0);
  if (!items.length || valid !== picks.length) {
    throw new Error('The days you chose are no longer available to replace. Please tap Find again.');
  }
  return { crew: found.crew, items: items };
}

function validateSelection_(eventId, phaseIds, held, regs, replaced) {
  const ev = readAll_('Events').filter(function (e) {
    return str_(e.EventID) === str_(eventId) && str_(e.Status) === 'Published';
  })[0];
  if (!ev) throw new Error('This event is no longer open for registration.');
  const ids = [];
  // When replacing, the new crew takes over the chosen job scopes and days, even if they are full.
  // The restriction grid still applies.
  const source = replaced ? replaced.items.map(function (it) { return it.row.PhaseID; }) : phaseIds;
  if (!Array.isArray(source) || !source.length) throw new Error('Please choose at least one job scope.');
  source.forEach(function (id) { id = str_(id); if (ids.indexOf(id) < 0) ids.push(id); });

  const map = {};
  readAll_('Phases').forEach(function (p) {
    if (str_(p.EventID) === str_(eventId)) map[str_(p.PhaseID)] = p;
  });
  const counts = confirmedCounts_(regs);
  ids.forEach(function (id) {
    const p = map[id];
    if (!p) throw new Error('One of the job scopes you chose is no longer available. Please refresh the page.');
    if (held.indexOf(id) >= 0) throw new Error('You are already registered for ' + str_(p.JobScope) + '.');
    if (!replaced && (counts[id] || 0) >= (Number(p.Pax) || 0)) throw new Error(str_(p.JobScope) + ' is now full. Please choose another job scope.');
  });

  const all = held.filter(function (id) { return map[id]; }).concat(ids);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = map[all[i]], b = map[all[j]];
      if (list_(a.Conflicts).indexOf(all[j]) >= 0 || list_(b.Conflicts).indexOf(all[i]) >= 0) {
        throw new Error(str_(a.JobScope) + ' and ' + str_(b.JobScope) + ' cannot be taken together for this event.');
      }
    }
  }
  return { event: ev, phases: ids.map(function (id) { return map[id]; }) };
}

function nextCrewId_() {
  let max = 0;
  readAll_('Crew').forEach(function (c) {
    const m = str_(c.CrewID).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return CREW_ID_PREFIX + String(max + 1).padStart(4, '0');
}

function writeRegs_(crew, sel, regs, now, plan) {
  const jobsBefore = heldBy_(regs, crew.CrewID).length;
  const base = {
    Timestamp: now, CrewID: crew.CrewID, FullName: crew.FullName, Phone: crew.Phone,
    EventID: str_(sel.event.EventID), EventName: str_(sel.event.Name), Status: 'Confirmed', JobsBefore: jobsBefore
  };
  const phaseInfo = function (p) {
    return { PhaseID: str_(p.PhaseID), JobScope: str_(p.JobScope), DateText: str_(p.DateText), Wages: str_(p.Wages) };
  };
  if (!plan) {
    sel.phases.forEach(function (p) {
      const regId = newId_('RG');
      const days = phaseDays_(p);
      append_('Registrations', Object.assign({}, base, phaseInfo(p), {
        RegID: regId, SeatID: regId, Days: days.join(','), DaysCount: days.length || 1
      }));
    });
    return;
  }
  // Replacement: the new crew takes the chosen days of the same seat. The replaced crew keeps
  // any days not taken over, and their crew record is never removed.
  const who = str_(crew.FullName) + ' (' + str_(crew.CrewID) + ')';
  plan.items.forEach(function (it) {
    const r = it.row;
    const dayText = it.days.map(dayLabel_).join(', ');
    append_('Registrations', Object.assign({}, base, phaseInfo(it.phase || r), {
      RegID: newId_('RG'), SeatID: str_(r.SeatID) || str_(r.RegID),
      Days: it.days.join(','), DaysCount: it.days.length,
      ReplacementOf: str_(r.FullName) + ' (' + str_(r.CrewID) + '): ' + dayText
    }));
    const left = it.avail.filter(function (d) { return it.days.indexOf(d) < 0; });
    r.SeatID = str_(r.SeatID) || str_(r.RegID);
    r.Days = left.join(',');
    r.DaysCount = left.length;
    if (!left.length) r.Status = 'Replaced';
    r.ReplacedBy = (str_(r.ReplacedBy) ? str_(r.ReplacedBy) + '; ' : '') + dayText + ' by ' + who;
    update_('Registrations', r);
  });
}

function result_(crew, sel, isNew, plan) {
  const out = function (p, days) {
    return {
      jobScope: str_(p.JobScope), dateText: str_(p.DateText), timeText: str_(p.TimeText),
      callTime: str_(p.CallTime), venue: str_(p.Venue), wages: str_(p.Wages), whatsapp: str_(p.WhatsApp),
      days: days.filter(function (d) { return d !== 'ALL'; }).map(dayLabel_)
    };
  };
  return {
    fullName: str_(crew.FullName), isNew: isNew, email: str_(crew.Email), qrToken: str_(crew.QRToken),
    eventName: str_(sel.event.Name),
    replacing: plan ? str_(plan.crew.FullName || plan.items[0].row.FullName) : '',
    registered: plan
      ? plan.items.map(function (it) { return out(it.phase || {}, it.days); })
      : sel.phases.map(function (p) { return out(p, phaseDays_(p)); })
  };
}

function submit_(req) {
  const out = withLock_(function () { return submitLocked_(req); });
  // Emails are sent after the lock is released so other crew are not kept waiting.
  sendSubmitEmails_(out.mail);
  return out.result;
}

function submitLocked_(req) {
  return (function () {
    const ag = getAgreement_();
    const regs = readAll_('Registrations');
    const now = new Date();

    if (req.mode === 'new') {
      const d = cleanDetails_(req.details || {});
      if (readAll_('Crew').some(function (c) { return str_(c.IDKey) === d.IDKey; })) {
        throw new Error('This IC or passport number has already been registered. Please go back and choose "I have registered before".');
      }
      const icFiles = (Array.isArray(req.icCopy) ? req.icCopy : [req.icCopy]).filter(Boolean);
      if (!req.photo) throw new Error('Please attach your profile photo.');
      if (!icFiles.length) throw new Error('Please attach your IC or passport copy.');
      if (icFiles.length > MAX_IC_FILES) throw new Error('Please attach at most ' + MAX_IC_FILES + ' files for your IC or passport copy.');
      requireAgreement_(req, ag);
      const replaced = req.replacing ? planReplacement_(req.eventId, req.replacing, regs, '') : null;
      const sel = validateSelection_(req.eventId, req.phaseIds, [], regs, replaced);
      const crewId = nextCrewId_();
      const base = crewId + '_' + fileSafe_(d.FullName);
      const crew = Object.assign(d, {
        CrewID: crewId,
        PhotoLink: saveFile_(req.photo, 'photo', base, 'profile photo'),
        ICCopyLink: icFiles.map(function (f, i) { return saveFile_(f, 'ic', base + '_' + (i + 1), 'IC or passport copy'); }).join('\n'),
        SignedVersion: ag.version,
        SignedAgreementLink: saveFile_(req.signedAgreementPdf, 'agreement', base + '_v' + ag.version, 'signed agreement'),
        SignedAt: now, CreatedAt: now, UpdatedAt: now, QRToken: newQrToken_()
      });
      append_('Crew', crew);
      writeRegs_(crew, sel, regs, now, replaced);
      const result = result_(crew, sel, true, replaced);
      return { result: result, mail: { crew: crew, welcome: 'new', result: result, plan: replaced } };
    }

    const crew = findVerifiedCrew_(req.idNumber, req.phoneLast4);
    const replaced = req.replacing ? planReplacement_(req.eventId, req.replacing, regs, crew.CrewID) : null;
    const sel = validateSelection_(req.eventId, req.phaseIds, heldBy_(regs, crew.CrewID), regs, replaced);
    const updates = cleanUpdates_(req.updates || {});
    const base = str_(crew.CrewID) + '_' + fileSafe_(crew.FullName);
    let changed = false;
    let resigned = false;
    if (!str_(crew.QRToken)) { crew.QRToken = newQrToken_(); changed = true; }
    if (Number(crew.SignedVersion) !== ag.version) {
      resigned = true;
      requireAgreement_(req, ag);
      crew.SignedAgreementLink = saveFile_(req.signedAgreementPdf, 'agreement', base + '_v' + ag.version, 'signed agreement');
      crew.SignedVersion = ag.version;
      crew.SignedAt = now;
      changed = true;
    }
    if (req.photo) { crew.PhotoLink = saveFile_(req.photo, 'photo', base, 'profile photo'); changed = true; }
    Object.keys(updates).forEach(function (k) { crew[k] = updates[k]; changed = true; });
    if (changed) { crew.UpdatedAt = now; update_('Crew', crew); }
    writeRegs_(crew, sel, regs, now, replaced);
    const result = result_(crew, sel, false, replaced);
    return { result: result, mail: { crew: crew, welcome: resigned ? 'resigned' : '', result: result, plan: replaced } };
  })();
}

/* ---------- Admin ---------- */

function adminListEvents_() {
  const counts = confirmedCounts_(readAll_('Registrations'));
  const phases = readAll_('Phases');
  return readAll_('Events')
    .filter(function (ev) { return str_(ev.Status) !== 'Deleted'; })
    .map(function (ev) {
      const ph = phasesFor_(phases, ev.EventID, counts);
      return {
        eventId: str_(ev.EventID), name: str_(ev.Name), location: str_(ev.Location),
        description: str_(ev.Description), status: str_(ev.Status), createdAt: ev.CreatedAt, scannerPin: str_(ev.ScannerPIN),
        phases: ph,
        filled: ph.reduce(function (s, p) { return s + p.filled; }, 0),
        pax: ph.reduce(function (s, p) { return s + p.pax; }, 0)
      };
    })
    .reverse();
}

function adminSaveEvent_(req) {
  return withLock_(function () {
    const e = req.event || {};
    const input = Array.isArray(req.phases) ? req.phases : [];
    const name = clip_(e.name, 150);
    if (!name) throw new Error('Please give the event a name.');
    if (!input.length) throw new Error('Please add at least one job scope.');
    const status = (e.status === 'Published' || e.status === 'Paused') ? e.status : 'Paused';
    const now = new Date();

    const clean = input.map(function (p, i) {
      const id = str_(p.phaseId).toUpperCase();
      if (!/^PH[A-Z0-9]{4,30}$/.test(id)) throw new Error('Invalid job scope reference. Please reload the page.');
      const js = clip_(p.jobScope, 150);
      if (!js) throw new Error('Job scope ' + (i + 1) + ' needs a name.');
      const pax = Math.floor(Number(p.pax));
      if (!(pax >= 1)) throw new Error('Please set the number of pax for ' + js + '.');
      const start = isoDate_(p.startDate), end = isoDate_(p.endDate) || isoDate_(p.startDate);
      if (!start) throw new Error('Please set the start date for ' + js + '.');
      if (end < start) throw new Error('The end date for ' + js + ' is before its start date.');
      if ((new Date(end) - new Date(start)) / 86400000 > 60) throw new Error(js + ' cannot run for more than 60 days.');
      const wa = clip_(p.whatsapp, 300);
      if (wa && !/^https:\/\//i.test(wa)) throw new Error('The WhatsApp link for ' + js + ' must start with https://');
      return {
        PhaseID: id, Order: i + 1, JobScope: js, Pax: pax,
        DateText: clip_(p.dateText, 150), TimeText: clip_(p.timeText, 150), CallTime: clip_(p.callTime, 60),
        Venue: clip_(p.venue, 200), Wages: clip_(p.wages, 100), StartDate: start, EndDate: end, WhatsApp: wa,
        conflicts: Array.isArray(p.conflicts) ? p.conflicts.map(function (x) { return str_(x).toUpperCase(); }) : []
      };
    });
    const ids = clean.map(function (p) { return p.PhaseID; });
    if (ids.some(function (id, i) { return ids.indexOf(id) !== i; })) throw new Error('Duplicate job scope reference. Please reload the page.');

    // Restrictions are always two way.
    const cmap = {};
    clean.forEach(function (p) { cmap[p.PhaseID] = {}; });
    clean.forEach(function (p) {
      p.conflicts.forEach(function (o) {
        if (o !== p.PhaseID && cmap[o]) { cmap[p.PhaseID][o] = true; cmap[o][p.PhaseID] = true; }
      });
    });
    clean.forEach(function (p) { p.Conflicts = Object.keys(cmap[p.PhaseID]).join(','); delete p.conflicts; });

    const pin = clip_(e.scannerPin, 20).toUpperCase();
    if (pin && !/^[A-Z0-9]{4,20}$/.test(pin)) throw new Error('The scanner PIN must be 4 to 20 letters or numbers.');

    let eventId = str_(e.eventId);
    let ev = null;
    if (pin && readAll_('Events').some(function (x) {
      return str_(x.EventID) !== eventId && str_(x.Status) !== 'Deleted' && str_(x.ScannerPIN).toUpperCase() === pin;
    })) throw new Error('Another event already uses this scanner PIN. Please choose a different one.');
    if (eventId) {
      ev = readAll_('Events').filter(function (x) {
        return str_(x.EventID) === eventId && str_(x.Status) !== 'Deleted';
      })[0];
      if (!ev) throw new Error('Event not found.');
    }

    const allPhases = readAll_('Phases');
    const counts = confirmedCounts_(readAll_('Registrations'));
    const existing = allPhases.filter(function (p) { return eventId && str_(p.EventID) === eventId; });
    allPhases.forEach(function (p) {
      if (ids.indexOf(str_(p.PhaseID)) >= 0 && str_(p.EventID) !== eventId) {
        throw new Error('Job scope reference clash. Please reload the page and try again.');
      }
    });
    existing.forEach(function (p) {
      if (ids.indexOf(str_(p.PhaseID)) < 0 && (counts[str_(p.PhaseID)] || 0) > 0) {
        throw new Error('Cannot remove ' + str_(p.JobScope) + ' because crew have already registered for it. Cancel those registrations first.');
      }
    });
    clean.forEach(function (p) {
      const f = counts[p.PhaseID] || 0;
      if (p.Pax < f) throw new Error(p.JobScope + ' already has ' + f + ' crew registered, so pax cannot be lower than ' + f + '.');
    });

    if (ev) {
      ev.Name = name; ev.Location = clip_(e.location, 200); ev.Description = clip_(e.description, 1000);
      ev.Status = status; ev.UpdatedAt = now; ev.ScannerPIN = pin;
      update_('Events', ev);
    } else {
      eventId = newId_('EV');
      append_('Events', {
        EventID: eventId, Name: name, Location: clip_(e.location, 200), Description: clip_(e.description, 1000),
        Status: status, CreatedAt: now, UpdatedAt: now, ScannerPIN: pin
      });
    }

    clean.forEach(function (p) {
      p.EventID = eventId;
      const ex = existing.filter(function (x) { return str_(x.PhaseID) === p.PhaseID; })[0];
      if (ex) { p._row = ex._row; update_('Phases', p); }
      else append_('Phases', p);
    });
    existing.filter(function (x) { return ids.indexOf(str_(x.PhaseID)) < 0; })
      .map(function (x) { return x._row; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (r) { sheet_('Phases').deleteRow(r); });

    return { eventId: eventId, status: status };
  });
}

function adminSetStatus_(req) {
  return withLock_(function () {
    const status = str_(req.status);
    if (STATUSES.indexOf(status) < 0) throw new Error('Invalid status.');
    const ev = readAll_('Events').filter(function (x) { return str_(x.EventID) === str_(req.eventId); })[0];
    if (!ev) throw new Error('Event not found.');
    ev.Status = status; ev.UpdatedAt = new Date();
    update_('Events', ev);
    return { eventId: str_(ev.EventID), status: status };
  });
}

function crewOut_(c, jobs) {
  const link = function (v) { const s = str_(v); return s.indexOf('http') === 0 ? s : ''; };
  return {
    crewId: str_(c.CrewID), fullName: str_(c.FullName), preferredName: str_(c.PreferredName),
    idNumber: str_(c.IDNumber), nationality: str_(c.Nationality), email: str_(c.Email), phone: str_(c.Phone),
    gender: str_(c.Gender), languages: str_(c.Languages),
    shirtSize: str_(c.ShirtSize), healthCondition: str_(c.HealthCondition), dietary: str_(c.Dietary),
    jobExperience: str_(c.JobExperience), bankName: str_(c.BankName), bankAccount: str_(c.BankAccount),
    bankHolder: str_(c.BankHolder), photoLink: link(c.PhotoLink),
    icCopyLinks: str_(c.ICCopyLink).split(/\s+/).filter(function (u) { return u.indexOf('http') === 0; }),
    signedVersion: Number(c.SignedVersion) || 0, signedAgreementLink: link(c.SignedAgreementLink),
    jobsTotal: jobs[str_(c.CrewID)] || 0, createdAt: c.CreatedAt, emailStatus: str_(c.EmailStatus)
  };
}

function adminListRegistrations_(req) {
  const eventId = str_(req.eventId);
  const regs = readAll_('Registrations');
  const jobs = jobsByCrew_(regs);
  const counts = confirmedCounts_(regs);
  const crewMap = {};
  readAll_('Crew').forEach(function (c) { crewMap[str_(c.CrewID)] = c; });
  const ev = readAll_('Events').filter(function (x) { return str_(x.EventID) === eventId; })[0];
  if (!ev) throw new Error('Event not found.');
  const phMap = phaseMap_(eventId);
  return {
    event: { eventId: eventId, name: str_(ev.Name), status: str_(ev.Status) },
    phases: phasesFor_(readAll_('Phases'), eventId, counts),
    registrations: regs.filter(function (r) { return str_(r.EventID) === eventId; }).map(function (r) {
      const c = crewOut_(crewMap[str_(r.CrewID)] || {}, jobs);
      return Object.assign(c, {
        regId: str_(r.RegID), timestamp: r.Timestamp, crewId: str_(r.CrewID),
        fullName: c.fullName || str_(r.FullName), phone: c.phone || str_(r.Phone),
        phaseId: str_(r.PhaseID), jobScope: str_(r.JobScope), status: str_(r.Status),
        jobsBefore: Number(r.JobsBefore) || 0,
        replacementOf: str_(r.ReplacementOf), replacedBy: str_(r.ReplacedBy),
        days: rowDays_(r, phMap[str_(r.PhaseID)]).filter(function (d) { return d !== 'ALL'; }).map(dayLabel_),
        daysCount: str_(r.Status) === 'Confirmed' ? (str_(r.DaysCount) === '' ? Math.max(1, phaseDays_(phMap[str_(r.PhaseID)] || {}).length) : Number(r.DaysCount) || 0) : 0
      });
    })
  };
}

function adminCancelRegistration_(req) {
  return withLock_(function () {
    const r = readAll_('Registrations').filter(function (x) { return str_(x.RegID) === str_(req.regId); })[0];
    if (!r) throw new Error('Registration not found.');
    r.Status = 'Cancelled';
    update_('Registrations', r);
    return { regId: str_(r.RegID) };
  });
}

function adminListCrew_() {
  const jobs = jobsByCrew_(readAll_('Registrations'));
  return readAll_('Crew').map(function (c) { return crewOut_(c, jobs); }).reverse();
}

function adminSaveAgreement_(req) {
  return withLock_(function () {
    const intro = clip_(req.intro, 1000);
    const acks = (Array.isArray(req.acknowledgements) ? req.acknowledgements : [])
      .map(function (a) { return clip_(a, 600); }).filter(Boolean).slice(0, 12);
    if (!acks.length) throw new Error('Please keep at least one acknowledgement statement.');
    setSetting_('agreementIntro', intro || DEFAULT_AGREEMENT_INTRO);
    setSetting_('agreementAcks', JSON.stringify(acks));
    if (req.newVersion) setSetting_('agreementVersion', (Number(getSetting_('agreementVersion')) || 1) + 1);
    return getAgreement_();
  });
}

/* ---------- Emails ---------- */

function esc_(v) {
  return str_(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function newQrToken_() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const used = {};
  readAll_('Crew').forEach(function (c) { used[str_(c.QRToken)] = true; });
  let t = '';
  do {
    t = '';
    for (let i = 0; i < 10; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (used[t]);
  return t;
}

function qrBlob_(token) {
  const q = qrcode(0, 'M');
  q.addData(QR_PREFIX + token);
  q.make();
  const dataUrl = q.createDataURL(8, 4);
  return Utilities.newBlob(Utilities.base64Decode(dataUrl.split(',')[1]), 'image/gif', 'my-crew-qr-code.gif');
}

function driveId_(url) {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(str_(url)) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(str_(url));
  return m ? m[1] : '';
}

// Marks the crew's Email cell red when an email fails, and clears it when one succeeds.
function markEmail_(crewId, status) {
  const crew = readAll_('Crew').filter(function (c) { return str_(c.CrewID) === str_(crewId); })[0];
  if (!crew) return;
  crew.EmailStatus = status;
  update_('Crew', crew);
  const col = SHEETS.Crew.indexOf('Email') + 1;
  sheet_('Crew').getRange(crew._row, col).setBackground(status === 'Sent' ? null : '#f4c7c3');
}

// Sends one email. Returns '' when sent, or the reason it failed. The caller records the result.
function sendMail_(crew, subject, body, extra) {
  const to = str_(crew.Email);
  if (!to) return 'no email address';
  try {
    MailApp.sendEmail(Object.assign({
      to: to, subject: subject, name: SENDER_NAME, replyTo: REPLY_TO, htmlBody: emailLayout_(body)
    }, extra || {}));
    return '';
  } catch (err) {
    return clip_(err && err.message ? err.message : err, 200);
  }
}

// One status per batch: if any email to this crew failed, the cell stays red.
function recordEmails_(crewId, errors) {
  const failed = errors.filter(String);
  markEmail_(crewId, failed.length ? 'Failed: ' + failed[0] : 'Sent');
  return !failed.length;
}

function emailLayout_(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111418;max-width:600px;margin:0 auto">' +
    '<div style="background:#09263d;background:linear-gradient(90deg,#09263d,#970a44);color:#fff;padding:18px 22px;border-bottom:5px solid #ffe549">' +
    '<div style="font-size:12px;letter-spacing:.08em;opacity:.85">WHEEE SDN. BHD. AND WOOTS EVENT PLT</div>' +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">Marathon Crew</div></div>' +
    '<div style="padding:20px 22px;border:1px solid #ddd6c2;border-top:0">' + inner + '</div>' +
    '<div style="font-size:12px;color:#5c6b78;padding:12px 22px">Questions? Reply to this email or write to ' + REPLY_TO + '.</div></div>';
}

function welcomeEmail_(crew, kind) {
  const fileId = driveId_(crew.SignedAgreementLink);
  const attachments = [];
  if (fileId) {
    try { attachments.push(DriveApp.getFileById(fileId).getBlob().setName('Signed Event Crew Agreement.pdf')); } catch (e) { /* sent without attachment */ }
  }
  const intro = kind === 'resigned'
    ? '<p>Thank you for signing the updated Event Crew Agreement. A copy of your signed agreement is attached.</p>'
    : '<p>Your crew registration with Wheee Sdn. Bhd. and Woots Event PLT is successful. A copy of your signed Event Crew Agreement is attached.</p>';
  const body = '<p>Hi ' + esc_(crew.PreferredName || crew.FullName) + ',</p>' + intro +
    '<p><strong>Please keep this email.</strong> It is your proof of the signed agreement, which is required for identity verification before any cash payment.</p>' +
    '<div style="background:#fff9d9;border-left:4px solid #ffe549;padding:10px 14px;margin:16px 0">' +
    '<strong>Next time you register for an event</strong><br>Choose "I have registered before", then sign in with:<br>' +
    '1. Your IC or passport number<br>2. The last 4 digits of your phone number</div>' +
    '<p>You do not need to fill in your details or sign the agreement again.</p>';
  return sendMail_(crew, kind === 'resigned' ? 'Updated crew agreement signed' : 'Registration successful: welcome to the crew', body, { attachments: attachments });
}

function jobEmail_(crew, result) {
  const rows = result.registered.map(function (p) {
    const lines = [];
    if (p.days.length) lines.push('<strong>Your day' + (p.days.length > 1 ? 's' : '') + ':</strong> ' + esc_(p.days.join(', ')));
    if (p.timeText) lines.push('<strong>Time:</strong> ' + esc_(p.timeText) + (p.callTime ? ' (Call time: ' + esc_(p.callTime) + ')' : ''));
    else if (p.callTime) lines.push('<strong>Call time:</strong> ' + esc_(p.callTime));
    if (p.venue) lines.push('<strong>Venue:</strong> ' + esc_(p.venue));
    if (p.wages) lines.push('<strong>Wages:</strong> ' + esc_(p.wages));
    const wa = p.whatsapp ? '<a href="' + esc_(p.whatsapp) + '" style="display:inline-block;margin-top:8px;background:#25d366;color:#fff;text-decoration:none;font-weight:bold;padding:9px 14px;border-radius:8px">Join the WhatsApp group</a>' : '';
    return '<div style="border:1px solid #ddd6c2;border-radius:10px;padding:12px 14px;margin:10px 0">' +
      '<div style="font-size:16px;font-weight:bold;color:#970a44">' + esc_(p.jobScope) + '</div>' + lines.join('<br>') + '<br>' + wa + '</div>';
  }).join('');
  const blob = qrBlob_(crew.QRToken);
  const body = '<p>Hi ' + esc_(crew.PreferredName || crew.FullName) + ',</p>' +
    '<p>You are confirmed for <strong>' + esc_(result.eventName) + '</strong>.' +
    (result.replacing ? ' You are replacing <strong>' + esc_(result.replacing) + '</strong> for the day(s) below.' : '') + '</p>' + rows +
    '<p style="margin-top:14px"><strong>Full commitment is required.</strong> You must attend every day listed above.</p>' +
    '<div style="text-align:center;border:1px solid #ddd6c2;border-radius:10px;padding:16px;margin:18px 0">' +
    '<div style="font-size:16px;font-weight:bold;color:#09263d">Your personal check in QR code</div>' +
    '<img src="cid:qr" alt="Your QR code" width="220" height="220" style="margin:10px auto;display:block">' +
    '<div style="font-size:13px;color:#5c6b78">Code: <strong style="letter-spacing:.1em">' + esc_(crew.QRToken) + '</strong></div>' +
    '<p style="text-align:left;margin:12px 0 0">Show this QR code to your coordinator at <strong>check in</strong>, at every <strong>roll call</strong> during your shift, and at <strong>check out</strong>. Missing any of these may affect your payment. The same QR code works for every event.</p></div>' +
    '<p>All payouts will be made within 10 working days from the event day.</p>';
  return sendMail_(crew, 'Job confirmed: ' + result.eventName, body, { inlineImages: { qr: blob }, attachments: [blob] });
}

function replacedEmail_(oldCrew, eventName, items, byName) {
  const list = items.map(function (it) {
    return '<li><strong>' + esc_(it.row.JobScope) + '</strong>: ' + esc_(it.days.map(dayLabel_).join(', ')) + '</li>';
  }).join('');
  const body = '<p>Hi ' + esc_(oldCrew.PreferredName || oldCrew.FullName) + ',</p>' +
    '<p><strong>' + esc_(byName) + '</strong> has registered as your replacement for <strong>' + esc_(eventName) + '</strong>:</p><ul>' + list + '</ul>' +
    '<p>You are released from these days only. Any other days and events you registered for stay the same. If this is a mistake, please reply to this email as soon as possible.</p>';
  return sendMail_(oldCrew, 'Replacement confirmed: ' + eventName, body);
}

function sendSubmitEmails_(m) {
  if (!m) return;
  try {
    const errs = [];
    if (m.welcome) errs.push(welcomeEmail_(m.crew, m.welcome));
    errs.push(jobEmail_(m.crew, m.result));
    recordEmails_(m.crew.CrewID, errs);
    if (m.plan && m.plan.crew && m.plan.crew.CrewID) {
      recordEmails_(m.plan.crew.CrewID, [replacedEmail_(m.plan.crew, m.result.eventName, m.plan.items, str_(m.crew.FullName))]);
    }
  } catch (err) {
    // A failed email never undoes a registration. The red Email cell tells the admin to follow up.
    Logger.log('Email error: ' + err);
  }
}

// Runs every hour (set up by setup). Marks crew emails red when a delivery failure notice arrives.
function checkBounces() {
  const label = GmailApp.getUserLabelByName('Crew portal bounce checked') || GmailApp.createLabel('Crew portal bounce checked');
  const threads = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:7d -label:"Crew portal bounce checked"', 0, 50);
  if (!threads.length) return;
  const byEmail = {};
  readAll_('Crew').forEach(function (c) { if (str_(c.Email)) byEmail[str_(c.Email).toLowerCase()] = c; });
  threads.forEach(function (t) {
    t.getMessages().forEach(function (msg) {
      const text = (msg.getPlainBody() || '').toLowerCase();
      (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).forEach(function (addr) {
        const c = byEmail[addr];
        if (c && str_(c.EmailStatus).indexOf('Bounced') !== 0) markEmail_(c.CrewID, 'Bounced: email could not be delivered');
      });
    });
    t.addLabel(label);
  });
}

function adminResendEmail_(req) {
  const crew = readAll_('Crew').filter(function (c) { return str_(c.CrewID) === str_(req.crewId); })[0];
  if (!crew) throw new Error('Crew not found.');
  if (!str_(crew.QRToken)) { crew.QRToken = newQrToken_(); update_('Crew', crew); }
  if (req.kind === 'welcome') {
    if (!recordEmails_(crew.CrewID, [welcomeEmail_(crew, 'new')])) throw new Error('The email could not be sent. Please check the email address.');
    return { sent: true };
  }
  const regs = readAll_('Registrations').filter(function (r) {
    return str_(r.CrewID) === str_(crew.CrewID) && str_(r.EventID) === str_(req.eventId) && str_(r.Status) === 'Confirmed';
  });
  if (!regs.length) throw new Error('This crew has no confirmed job scope in this event.');
  const map = phaseMap_(req.eventId);
  const ev = readAll_('Events').filter(function (x) { return str_(x.EventID) === str_(req.eventId); })[0] || {};
  const result = {
    eventName: str_(ev.Name), replacing: '',
    registered: regs.map(function (r) {
      const p = map[str_(r.PhaseID)] || {};
      return {
        jobScope: str_(r.JobScope), timeText: str_(p.TimeText), callTime: str_(p.CallTime), venue: str_(p.Venue),
        wages: str_(p.Wages), whatsapp: str_(p.WhatsApp),
        days: rowDays_(r, p).filter(function (d) { return d !== 'ALL'; }).map(dayLabel_)
      };
    })
  };
  if (!recordEmails_(crew.CrewID, [jobEmail_(crew, result)])) throw new Error('The email could not be sent. Please check the email address.');
  return { sent: true };
}

/* ---------- QR scanning ---------- */

function todayIso_(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return Utilities.formatDate(d, PORTAL_TZ, 'yyyy-MM-dd');
}

function timeLabel_(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '' : Utilities.formatDate(d, PORTAL_TZ, 'h:mm a');
}

function eventByPin_(pin) {
  const p = str_(pin).toUpperCase();
  if (!p) throw new Error('Please enter the scanner PIN.');
  const ev = readAll_('Events').filter(function (x) {
    return str_(x.Status) !== 'Deleted' && str_(x.ScannerPIN).toUpperCase() === p;
  })[0];
  if (!ev) throw new Error('Wrong scanner PIN. Please check with the admin.');
  return ev;
}

function scanLogin_(req) {
  const ev = eventByPin_(req.pin);
  return { eventId: str_(ev.EventID), eventName: str_(ev.Name), today: todayIso_(0), todayLabel: dayLabel_(todayIso_(0)) };
}

// Profile photo for the scanner screen, as a small image. Cached for 6 hours.
function photoData_(link) {
  const id = driveId_(link);
  if (!id) return '';
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ph:' + id);
  if (hit) return hit;
  try {
    const file = DriveApp.getFileById(id);
    let blob = null;
    try { blob = file.getThumbnail(); } catch (e) { blob = null; }
    if (!blob && /^image\/(png|jpeg)$/.test(file.getMimeType()) && file.getSize() < 400000) blob = file.getBlob();
    if (!blob) return '';
    const data = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    if (data.length < 95000) cache.put('ph:' + id, data, 21600);
    return data;
  } catch (e) {
    return '';
  }
}

function scan_(req) {
  const ev = eventByPin_(req.pin);
  const type = str_(req.mode);
  if (!SCAN_TYPES[type]) throw new Error('Please choose Check in, a roll call or Check out.');
  const token = str_(req.code).toUpperCase().replace(/\s/g, '').replace(QR_PREFIX, '');
  const crew = token && readAll_('Crew').filter(function (c) { return str_(c.QRToken) === token; })[0];
  if (!crew) return { status: 'error', message: 'This QR code is not recognised.' };

  return withLock_(function () {
    const map = phaseMap_(ev.EventID);
    const mine = readAll_('Registrations').filter(function (r) {
      return str_(r.EventID) === str_(ev.EventID) && str_(r.CrewID) === str_(crew.CrewID) && str_(r.Status) === 'Confirmed';
    });
    const today = todayIso_(0), yesterday = todayIso_(-1);
    const onDay = function (day) {
      return mine.filter(function (r) {
        const days = rowDays_(r, map[str_(r.PhaseID)]);
        return days.indexOf(day) >= 0 || days.indexOf('ALL') >= 0;
      });
    };
    let day = today;
    let duty = onDay(today);
    // Overnight shifts: a roll call or check out after midnight still counts for the day that started yesterday.
    if (!duty.length && type !== 'CheckIn' && Number(Utilities.formatDate(new Date(), PORTAL_TZ, 'H')) < 12) {
      duty = onDay(yesterday);
      day = yesterday;
    }
    const base = {
      name: str_(crew.FullName), preferredName: str_(crew.PreferredName), photo: photoData_(crew.PhotoLink),
      jobScopes: duty.map(function (r) { return str_(r.JobScope); })
    };
    if (!duty.length) {
      const all = [];
      mine.forEach(function (r) { rowDays_(r, map[str_(r.PhaseID)]).forEach(function (d) { if (d !== 'ALL' && all.indexOf(d) < 0) all.push(d); }); });
      return Object.assign(base, {
        status: 'error',
        message: mine.length ? 'Not on duty today. Registered days: ' + all.sort().map(dayLabel_).join(', ') : 'Not registered for this event.'
      });
    }
    const now = new Date();
    const scans = readAll_('Attendance').filter(function (a) {
      return str_(a.EventID) === str_(ev.EventID) && str_(a.CrewID) === str_(crew.CrewID) && str_(a.Day) === day;
    });
    const ofType = scans.filter(function (a) { return str_(a.Type) === type; });
    const last = ofType.length ? ofType[ofType.length - 1] : null;
    if (type === 'CheckIn' && last) {
      return Object.assign(base, { status: 'duplicate', message: 'Already checked in at ' + timeLabel_(last.Timestamp) + '.' });
    }
    if (ROLL_CALLS.indexOf(type) >= 0 && last) {
      return Object.assign(base, { status: 'duplicate', message: 'Already scanned for ' + SCAN_TYPES[type].toLowerCase() + ' at ' + timeLabel_(last.Timestamp) + '.' });
    }
    if (last && now - new Date(last.Timestamp) < 10 * 60000) {
      return Object.assign(base, { status: 'duplicate', message: 'Already scanned for ' + SCAN_TYPES[type].toLowerCase() + ' at ' + timeLabel_(last.Timestamp) + '.' });
    }
    append_('Attendance', {
      ScanID: newId_('SC'), Timestamp: now, EventID: str_(ev.EventID), Day: day, CrewID: str_(crew.CrewID),
      FullName: str_(crew.FullName), Type: type, Scanner: clip_(req.scanner, 60)
    });
    const noCheckIn = type !== 'CheckIn' && !scans.some(function (a) { return str_(a.Type) === 'CheckIn'; });
    return Object.assign(base, {
      status: noCheckIn ? 'warning' : 'ok',
      message: SCAN_TYPES[type] + ' recorded at ' + timeLabel_(now) + '.' + (noCheckIn ? ' No check in recorded today.' : '')
    });
  });
}

/* ---------- Attendance lists ---------- */

function attendanceData_(eventId, phaseId, day) {
  const ev = readAll_('Events').filter(function (x) { return str_(x.EventID) === str_(eventId); })[0];
  if (!ev) throw new Error('Event not found.');
  const map = phaseMap_(eventId);
  const p = map[str_(phaseId)];
  if (!p) throw new Error('Job scope not found.');
  const days = phaseDays_(p);
  if (days.length && days.indexOf(day) < 0) throw new Error('Please choose a day of this job scope.');
  const crewMap = {};
  readAll_('Crew').forEach(function (c) { crewMap[str_(c.CrewID)] = c; });
  const regs = readAll_('Registrations').filter(function (r) {
    if (str_(r.EventID) !== str_(eventId) || str_(r.PhaseID) !== str_(phaseId) || str_(r.Status) !== 'Confirmed') return false;
    const rd = rowDays_(r, p);
    return rd.indexOf(day) >= 0 || rd.indexOf('ALL') >= 0;
  });
  const scans = readAll_('Attendance').filter(function (a) { return str_(a.EventID) === str_(eventId) && str_(a.Day) === day; });
  const ids = regs.map(function (r) { return str_(r.CrewID); });
  // A roll call is only required when it was actually held for this job scope that day.
  const held = ROLL_CALLS.filter(function (t) {
    return scans.some(function (a) { return str_(a.Type) === t && ids.indexOf(str_(a.CrewID)) >= 0; });
  });
  const rollCallHeld = held.length > 0;
  const upcoming = day > todayIso_(0);
  const rows = regs.map(function (r) {
    const c = crewMap[str_(r.CrewID)] || {};
    const mine = scans.filter(function (a) { return str_(a.CrewID) === str_(r.CrewID); });
    const pick = function (t) { return mine.filter(function (a) { return str_(a.Type) === t; }); };
    const ins = pick('CheckIn'), outs = pick('CheckOut');
    const rcs = ROLL_CALLS.map(pick);
    const missedRc = ROLL_CALLS.filter(function (t, i) { return held.indexOf(t) >= 0 && !rcs[i].length; });
    let status = 'Complete';
    if (upcoming && !mine.length) status = 'Upcoming';
    else if (!mine.length) status = 'Absent';
    else if (!ins.length || !outs.length || missedRc.length) status = 'Incomplete';
    const missing = [];
    if (status === 'Incomplete') {
      if (!ins.length) missing.push('check in');
      missedRc.forEach(function (t) { missing.push(SCAN_TYPES[t].toLowerCase()); });
      if (!outs.length) missing.push('check out');
    }
    return {
      crewId: str_(r.CrewID), name: str_(c.FullName || r.FullName), phone: str_(c.Phone || r.Phone),
      checkIn: ins.length ? timeLabel_(ins[0].Timestamp) : '',
      rollCalls: rcs.map(function (list) { return list.length ? timeLabel_(list[0].Timestamp) : ''; }),
      checkOut: outs.length ? timeLabel_(outs[outs.length - 1].Timestamp) : '',
      status: status, missing: missing, replacement: !!str_(r.ReplacementOf)
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  return {
    eventName: str_(ev.Name), jobScope: str_(p.JobScope), day: day, dayLabel: dayLabel_(day),
    timeText: str_(p.TimeText), callTime: str_(p.CallTime), venue: str_(p.Venue), rollCallHeld: rollCallHeld, rollCallsHeld: held, rows: rows
  };
}

function adminAttendance_(req) {
  return attendanceData_(req.eventId, req.phaseId, str_(req.day));
}

// Creates (or refreshes) a Google Sheet and a PDF for one job scope on one day, in the Attendance Lists folder.
function adminGenerateAttendance_(req) {
  const d = attendanceData_(req.eventId, req.phaseId, str_(req.day));
  const folder = subFolder_(FILE_FOLDERS.attendance);
  const key = 'att:' + str_(req.phaseId) + ':' + d.day;
  const title = fileSafe_(d.eventName) + ' ' + fileSafe_(d.jobScope) + ' ' + d.day + ' Attendance';
  let ssFile = null;
  const known = str_(getSetting_(key));
  if (known) { try { ssFile = DriveApp.getFileById(known.split(',')[0]); if (ssFile.isTrashed()) ssFile = null; } catch (e) { ssFile = null; } }
  let book;
  if (ssFile) {
    book = SpreadsheetApp.openById(ssFile.getId());
  } else {
    book = SpreadsheetApp.create(title);
    ssFile = DriveApp.getFileById(book.getId());
    ssFile.moveTo(folder);
  }
  const sh = book.getSheets()[0];
  sh.clear();
  sh.setName('Attendance');
  const W = 9;
  const pad = function (first) { const row = [first]; while (row.length < W) row.push(''); return row; };
  const info = [
    pad(d.eventName),
    pad('Job scope: ' + d.jobScope + '    Date: ' + d.dayLabel),
    pad([d.timeText ? 'Time: ' + d.timeText : '', d.callTime ? 'Call time: ' + d.callTime : '', d.venue ? 'Venue: ' + d.venue : ''].filter(String).join('    ')),
    pad(''),
    ['No.', 'Name', 'Phone', 'Check in', 'Roll call 1', 'Roll call 2', 'Roll call 3', 'Check out', 'Status']
  ];
  const body = d.rows.map(function (r, i) {
    return [i + 1, r.name + (r.replacement ? ' (replacement)' : ''), "'" + r.phone, r.checkIn,
      r.rollCalls[0], r.rollCalls[1], r.rollCalls[2], r.checkOut,
      r.status + (r.missing.length ? ': missing ' + r.missing.join(', ') : '')];
  });
  const empty = pad(''); empty[1] = 'No crew registered for this day';
  const all = info.concat(body.length ? body : [empty]);
  sh.getRange(1, 1, all.length, W).setValues(all);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sh.getRange(5, 1, 1, W).setFontWeight('bold').setBackground('#09263d').setFontColor('#ffffff');
  sh.getRange(5, 1, all.length - 4, W).setBorder(true, true, true, true, true, true);
  d.rows.forEach(function (r, i) {
    if (r.status === 'Incomplete' || r.status === 'Absent') sh.getRange(6 + i, W).setBackground('#f4c7c3');
  });
  [35, 190, 110, 70, 75, 75, 75, 75, 215].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  SpreadsheetApp.flush();

  const pdfBlob = ssFile.getAs('application/pdf').setName(title + '.pdf');
  const oldPdf = known.split(',')[1];
  if (oldPdf) { try { DriveApp.getFileById(oldPdf).setTrashed(true); } catch (e) { /* already gone */ } }
  const pdf = folder.createFile(pdfBlob);
  setSetting_(key, ssFile.getId() + ',' + pdf.getId());
  return { sheetUrl: book.getUrl(), pdfUrl: pdf.getUrl(), data: d };
}

/* ---------- QR code generator library (qrcode-generator 1.4.4, MIT license, Kazuhiko Arase) ---------- */

//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();
