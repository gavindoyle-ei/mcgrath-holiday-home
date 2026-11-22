/**
 * Family Holiday Homes - backend (Google Apps Script, bound to a Google Sheet)
 * Data: Google Sheet tabs. API: web app (POST JSON). Email: MailApp. Push: Firebase Cloud Messaging (HTTP v1).
 * Secret (service account JSON) lives in Script Properties as SA_JSON - never in this file.
 */

// ---- EDIT THESE ----
const ADMIN_EMAIL = 'gdoyle2@gmail.com';                // first admin (lowercase)
const APP_URL = 'https://gavindoyle-ei.github.io/mcgrath-holiday-home/';     // where the frontend is hosted
const APP_NAME = 'Family Holiday Homes';
const MAX_NIGHTS = 60;
// --------------------

const TABS = {
  Families:   ['id', 'name'],
  Members:    ['email', 'name', 'familyId', 'role', 'added'],
  Properties: ['id', 'name', 'color', 'notes', 'address', 'photo', 'photoFileId'],
  Bookings:   ['id', 'propertyId', 'familyId', 'by', 'start', 'end', 'guests', 'note', 'status', 'adminNote', 'created', 'decidedBy'],
  Tokens:     ['token', 'email', 'added']
};
const TZ = Session.getScriptTimeZone();

/* ============ ONE-TIME SETUP (run from the editor) ============ */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SS_ID', ss.getId());
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  Object.keys(TABS).forEach(name => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const cols = TABS[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  if (!rows_('Families').length) {
    const fid = id_();
    put_('Families', 'id', { id: fid, name: 'My family' });
    put_('Members', 'email', { email: ADMIN_EMAIL.toLowerCase(), name: 'Admin', familyId: fid, role: 'admin', added: today_() });
    put_('Properties', 'id', { id: id_(), name: 'Property 1', color: '#1f7a8c', notes: '', address: '', photo: '', photoFileId: '' });
    put_('Properties', 'id', { id: id_(), name: 'Property 2', color: '#c9822b', notes: '', address: '', photo: '', photoFileId: '' });
  }
  Logger.log('Setup done. Now deploy as a web app.');
}

/* ============ WEB APP ENTRY ============ */
function doGet() { return ContentService.createTextOutput('ok'); }

function doPost(e) {
  let out;
  try {
    out = handle_(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, error: err.user ? err.message : 'Something went wrong. Try again.' };
    if (!err.user) console.error(err.stack || err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(b) {
  if (b.action === 'requestCode') return requestCode_(String(b.email || ''));
  if (b.action === 'verifyCode') return verifyCode_(String(b.email || ''), String(b.code || ''));
  const me = auth_(b.token);
  const fn = ACTIONS[b.action];
  if (!fn) throw E('Unknown action');
  if (b.action !== 'init') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { fn(me, b); } finally { lock.releaseLock(); }
  }
  return { ok: true, state: state_(me.email) };
}

/* ============ HELPERS ============ */
const E = msg => { const e = new Error(msg); e.user = true; return e; };
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const ss_ = () => SpreadsheetApp.openById(prop_('SS_ID'));
const id_ = () => Utilities.getUuid().replace(/-/g, '').slice(0, 8);
const today_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validDate_ = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));
const fmt_ = s => Utilities.formatDate(new Date(s + 'T12:00:00'), TZ, 'EEE d MMM yyyy');
const nights_ = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const overlap_ = (a, b) => a.start < b.end && b.start < a.end;

function rows_(name) {
  const v = ss_().getSheetByName(name).getDataRange().getValues();
  const h = v.shift();
  return v.filter(r => r[0] !== '').map(r => Object.fromEntries(h.map((k, i) => [k, String(r[i])])));
}
function put_(name, key, obj) {
  const sh = ss_().getSheetByName(name), cols = TABS[name];
  const vals = sh.getDataRange().getValues();
  const row = cols.map(c => obj[c] == null ? '' : String(obj[c]));
  const write = r => sh.getRange(r, 1, 1, cols.length).setNumberFormat('@').setValues([row]); // '@' keeps dates as text
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(obj[key])) { write(i + 1); return; }
  }
  write(sh.getLastRow() + 1);
}
function del_(name, col, value) {
  const sh = ss_().getSheetByName(name), ci = TABS[name].indexOf(col);
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) if (String(vals[i][ci]) === String(value)) sh.deleteRow(i + 1);
}

/* ============ AUTH (emailed 6-digit code -> signed session token) ============ */
const b64u_ = x => Utilities.base64EncodeWebSafe(x).replace(/=+$/, '');
const sign_ = s => b64u_(Utilities.computeHmacSha256Signature(s, prop_('SECRET')));

function requestCode_(emailRaw) {
  const email = emailRaw.trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const member = rows_('Members').find(m => m.email === email);
  // Same response whether or not the email is known, so addresses can't be probed.
  if (member && !cache.get('rl:' + email)) {
    cache.put('rl:' + email, '1', 60);
    const code = ('000000' + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000)).slice(-6);
    cache.put('otp:' + email, sign_(code + email), 600);
    cache.put('otpn:' + email, '0', 600);
    mail_([email], 'Your sign-in code: ' + code,
      tpl_('Your sign-in code', '<p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:8px 0">' + code + '</p><p>It works for 10 minutes. If you didn’t ask for it, ignore this email.</p>', false));
  }
  return { ok: true };
}

function verifyCode_(emailRaw, code) {
  const email = emailRaw.trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const stored = cache.get('otp:' + email);
  const tries = parseInt(cache.get('otpn:' + email) || '0', 10);
  if (!stored || tries >= 5) throw E('That code has expired. Request a new one.');
  if (sign_(code.trim() + email) !== stored) {
    cache.put('otpn:' + email, String(tries + 1), 600);
    throw E('That code is not right.');
  }
  cache.remove('otp:' + email);
  const p = email + '|' + (Date.now() + 30 * 864e5);
  return { ok: true, token: b64u_(p) + '.' + sign_(p) };
}

function auth_(t) {
  const bad = () => E('unauthorized');
  if (!t || t.indexOf('.') < 0) throw bad();
  const [a, s] = t.split('.');
  let p;
  try { p = Utilities.newBlob(Utilities.base64DecodeWebSafe(a)).getDataAsString(); } catch (x) { throw bad(); }
  if (sign_(p) !== s) throw bad();
  const [email, exp] = p.split('|');
  if (Date.now() > +exp) throw bad();
  const m = rows_('Members').find(x => x.email === email);
  if (!m) throw bad();               // removed members lose access immediately
  return m;
}
const needAdmin_ = me => { if (me.role !== 'admin') throw E('Admins only.'); };

/* ============ STATE SENT TO THE APP ============ */
function state_(email) {
  const members = rows_('Members');
  const me = members.find(m => m.email === email);
  if (!me) throw E('unauthorized');
  const families = rows_('Families');
  const fname = id => (families.find(f => f.id === id) || { name: 'Unknown' }).name;
  const admin = me.role === 'admin';
  const t = today_();
  const nameOf = e => (members.find(m => m.email === e) || { name: e }).name;
  const bookings = rows_('Bookings').filter(b => {
    if (admin || b.familyId === me.familyId) return true;
    return (b.status === 'approved' || b.status === 'pending') && b.end >= t;
  }).map(b => {
    const full = admin || b.familyId === me.familyId;
    return {
      id: b.id, propertyId: b.propertyId, familyId: b.familyId, familyName: fname(b.familyId),
      start: b.start, end: b.end, status: b.status, mine: b.familyId === me.familyId,
      by: full ? nameOf(b.by) : '', guests: full ? b.guests : '', note: full ? b.note : '',
      adminNote: full ? b.adminNote : ''
    };
  });
  const out = {
    me: { email: me.email, name: me.name, role: me.role, familyId: me.familyId, familyName: fname(me.familyId) },
    properties: rows_('Properties'),
    bookings: bookings,
    today: t,
    appName: APP_NAME
  };
  if (admin) {
    const tokens = rows_('Tokens');
    out.families = families;
    out.members = members.map(m => ({ email: m.email, name: m.name, familyId: m.familyId, role: m.role, push: tokens.some(k => k.email === m.email) }));
  } else {
    out.families = families.filter(f => f.id === me.familyId);
  }
  return out;
}

/* ============ ACTIONS ============ */
const ACTIONS = {
  init: () => {},

  requestStay(me, b) {
    const prop = rows_('Properties').find(p => p.id === b.propertyId);
    if (!prop) throw E('Choose a property.');
    if (!validDate_(b.start) || !validDate_(b.end)) throw E('Choose check-in and check-out dates.');
    if (b.start < today_()) throw E('Check-in can’t be in the past.');
    if (b.end <= b.start) throw E('Check-out must be after check-in.');
    if (nights_(b.start, b.end) > MAX_NIGHTS) throw E('Stays are limited to ' + MAX_NIGHTS + ' nights.');
    const admin = me.role === 'admin';
    let familyId = me.familyId;
    if (b.familyId && b.familyId !== me.familyId) {
      needAdmin_(me);
      if (!rows_('Families').some(f => f.id === b.familyId)) throw E('Unknown family.');
      familyId = b.familyId;
    }
    const clash = rows_('Bookings').find(x => x.propertyId === prop.id && x.status === 'approved' && overlap_(x, b));
    if (clash) throw E('Those dates overlap an approved stay (' + fmt_(clash.start) + ' to ' + fmt_(clash.end) + ').');
    const direct = admin && b.approveNow;
    const bk = {
      id: id_(), propertyId: prop.id, familyId: familyId, by: me.email, start: b.start, end: b.end,
      guests: String(Math.max(0, parseInt(b.guests, 10) || 0)), note: String(b.note || '').slice(0, 500),
      status: direct ? 'approved' : 'pending', adminNote: '', created: today_(), decidedBy: direct ? me.email : ''
    };
    put_('Bookings', 'id', bk);
    const fam = rows_('Families').find(f => f.id === familyId);
    const what = esc_(prop.name) + ', ' + fmt_(b.start) + ' to ' + fmt_(b.end);
    if (direct) {
      notify_(familyEmails_(familyId), 'Stay confirmed: ' + prop.name, fmt_(b.start) + ' to ' + fmt_(b.end),
        tpl_('Stay confirmed', '<p>An admin booked <b>' + what + '</b> for ' + esc_(fam.name) + '.</p>', true));
    } else {
      mail_([me.email], 'Request received: ' + prop.name,
        tpl_('Request received', '<p>We’ve got your request for <b>' + what + '</b>. An admin will review it and you’ll hear back by email.</p>', true));
      notify_(adminEmails_(), 'New stay request', me.name + ' (' + fam.name + '): ' + prop.name + ', ' + b.start + ' to ' + b.end,
        tpl_('New stay request', '<p><b>' + esc_(me.name) + '</b> (' + esc_(fam.name) + ') requested <b>' + what + '</b>.</p>' +
          (bk.note ? '<p>Note: ' + esc_(bk.note) + '</p>' : '') + '<p>Open the app to approve or decline.</p>', true));
    }
  },

  decide(me, b) {
    needAdmin_(me);
    const bk = rows_('Bookings').find(x => x.id === b.id);
    if (!bk || bk.status !== 'pending') throw E('That request is no longer pending.');
    const approve = b.decision === 'approve';
    if (approve) {
      const clash = rows_('Bookings').find(x => x.id !== bk.id && x.propertyId === bk.propertyId && x.status === 'approved' && overlap_(x, bk));
      if (clash) throw E('Overlaps an approved stay (' + fmt_(clash.start) + ' to ' + fmt_(clash.end) + ').');
    }
    bk.status = approve ? 'approved' : 'declined';
    bk.adminNote = String(b.note || '').slice(0, 500);
    bk.decidedBy = me.email;
    put_('Bookings', 'id', bk);
    const prop = rows_('Properties').find(p => p.id === bk.propertyId) || { name: 'the property' };
    const when = fmt_(bk.start) + ' to ' + fmt_(bk.end);
    const to = familyEmails_(bk.familyId);
    if (to.indexOf(bk.by) < 0) to.push(bk.by);
    notify_(to, approve ? 'Stay approved: ' + prop.name : 'Stay declined: ' + prop.name,
      prop.name + ', ' + when,
      tpl_(approve ? 'Stay approved' : 'Stay declined',
        '<p><b>' + esc_(prop.name) + ', ' + when + '</b> was ' + (approve ? 'approved.' : 'declined.') + ' by ' + esc_(me.name) + '.</p>' +
        (bk.adminNote ? '<p>Note from admin: ' + esc_(bk.adminNote) + '</p>' : ''), true),
      me.email); // reply-to: this admin decided, so replies should reach them directly even though all mail sends from the shared account
  },

  cancelBooking(me, b) {
    const bk = rows_('Bookings').find(x => x.id === b.id);
    if (!bk) throw E('Booking not found.');
    const admin = me.role === 'admin';
    if (!admin && bk.familyId !== me.familyId) throw E('You can only cancel your own family’s stays.');
    if (bk.status !== 'pending' && bk.status !== 'approved') throw E('That stay is already closed.');
    const wasApproved = bk.status === 'approved';
    bk.status = 'cancelled';
    put_('Bookings', 'id', bk);
    const prop = rows_('Properties').find(p => p.id === bk.propertyId) || { name: 'the property' };
    const msg = prop.name + ', ' + fmt_(bk.start) + ' to ' + fmt_(bk.end);
    if (admin) {
      notify_(familyEmails_(bk.familyId), 'Stay cancelled: ' + prop.name, msg,
        tpl_('Stay cancelled', '<p>An admin cancelled <b>' + esc_(msg) + '</b>.</p>', true));
    } else if (wasApproved) {
      const fam = rows_('Families').find(f => f.id === bk.familyId) || { name: '' };
      notify_(adminEmails_(), 'Stay cancelled', me.name + ' cancelled ' + msg,
        tpl_('Stay cancelled', '<p><b>' + esc_(me.name) + '</b> (' + esc_(fam.name) + ') cancelled <b>' + esc_(msg) + '</b>.</p>', true));
    }
  },

  addFamily(me, b) {
    needAdmin_(me);
    const name = String(b.name || '').trim();
    if (!name) throw E('Enter a family name.');
    put_('Families', 'id', { id: id_(), name: name.slice(0, 60) });
  },
  renameFamily(me, b) {
    needAdmin_(me);
    const f = rows_('Families').find(x => x.id === b.id);
    const name = String(b.name || '').trim();
    if (!f || !name) throw E('Enter a family name.');
    f.name = name.slice(0, 60);
    put_('Families', 'id', f);
  },
  removeFamily(me, b) {
    needAdmin_(me);
    if (b.id === me.familyId) throw E('You can’t remove your own family.');
    const mem = rows_('Members').filter(m => m.familyId === b.id);
    if (mem.some(m => m.role === 'admin')) throw E('This family has an admin. Remove their admin role first.');
    mem.forEach(m => { del_('Tokens', 'email', m.email); del_('Members', 'email', m.email); });
    rows_('Bookings').filter(x => x.familyId === b.id && x.end >= today_() && (x.status === 'pending' || x.status === 'approved'))
      .forEach(x => { x.status = 'cancelled'; put_('Bookings', 'id', x); });
    del_('Families', 'id', b.id);
  },

  addMember(me, b) {
    needAdmin_(me);
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw E('Enter a valid email address.');
    if (!name) throw E('Enter a name.');
    if (!rows_('Families').some(f => f.id === b.familyId)) throw E('Choose a family.');
    if (rows_('Members').some(m => m.email === email)) throw E('That email is already registered.');
    put_('Members', 'email', { email: email, name: name.slice(0, 60), familyId: b.familyId, role: b.role === 'admin' ? 'admin' : 'member', added: today_() });
    welcome_(email, name);
  },
  removeMember(me, b) {
    needAdmin_(me);
    const email = String(b.email || '').toLowerCase();
    if (email === me.email) throw E('You can’t remove yourself.');
    const m = rows_('Members').find(x => x.email === email);
    if (!m) throw E('Member not found.');
    if (m.role === 'admin' && rows_('Members').filter(x => x.role === 'admin').length <= 1) throw E('There must be at least one admin.');
    del_('Tokens', 'email', email);
    del_('Members', 'email', email);
  },
  setRole(me, b) {
    needAdmin_(me);
    const m = rows_('Members').find(x => x.email === String(b.email || '').toLowerCase());
    if (!m) throw E('Member not found.');
    const role = b.role === 'admin' ? 'admin' : 'member';
    if (m.role === 'admin' && role === 'member' && rows_('Members').filter(x => x.role === 'admin').length <= 1) throw E('There must be at least one admin.');
    m.role = role;
    put_('Members', 'email', m);
  },
  resendWelcome(me, b) {
    needAdmin_(me);
    const m = rows_('Members').find(x => x.email === String(b.email || '').toLowerCase());
    if (!m) throw E('Member not found.');
    welcome_(m.email, m.name);
  },

  saveProperty(me, b) {
    needAdmin_(me);
    const name = String(b.name || '').trim();
    if (!name) throw E('Enter a property name.');
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#1f7a8c';
    const existing = rows_('Properties').find(p => p.id === b.id) || { photo: '', photoFileId: '' };
    let photo = existing.photo, photoFileId = existing.photoFileId;
    if (b.removePhoto && photoFileId) { trashDriveFile_(photoFileId); photo = ''; photoFileId = ''; }
    if (b.photoData) {
      const saved = savePhoto_(b.photoData, photoFileId, name);
      photo = saved.url; photoFileId = saved.fileId;
    }
    put_('Properties', 'id', {
      id: b.id || id_(), name: name.slice(0, 60), color: color, notes: String(b.notes || '').slice(0, 300),
      address: String(b.address || '').slice(0, 200), photo: photo, photoFileId: photoFileId
    });
  },
  removeProperty(me, b) {
    needAdmin_(me);
    if (rows_('Bookings').some(x => x.propertyId === b.id)) throw E('This property has bookings, so it can’t be deleted. Rename it instead.');
    if (rows_('Properties').length <= 1) throw E('Keep at least one property.');
    const p = rows_('Properties').find(x => x.id === b.id);
    if (p && p.photoFileId) trashDriveFile_(p.photoFileId);
    del_('Properties', 'id', b.id);
  },

  saveToken(me, b) {
    const t = String(b.pushToken || '');
    if (t.length < 20) throw E('Invalid push token.');
    put_('Tokens', 'token', { token: t, email: me.email, added: today_() });
    const mine = rows_('Tokens').filter(x => x.email === me.email);
    mine.slice(0, Math.max(0, mine.length - 5)).forEach(x => del_('Tokens', 'token', x.token)); // keep newest 5 devices
  },
  removeToken(me, b) {
    del_('Tokens', 'token', String(b.pushToken || ''));
  },
  testPush(me) {
    if (!push_([me.email], APP_NAME, 'Push notifications are working.')) throw E('No device is registered for push yet.');
  }
};

/* ============ PROPERTY PHOTOS (Google Drive, free, no card) ============ */
const PHOTO_FOLDER_NAME = 'Holiday Homes photos';
function photoFolder_() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}
function trashDriveFile_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone - fine */ }
}
/** data is a data: URL ("data:image/jpeg;base64,...") from the browser, already resized client-side. */
function savePhoto_(dataUrl, oldFileId, baseName) {
  const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw E('Could not read that photo. Try a different image.');
  const mime = m[1], b64 = m[2];
  if (b64.length > 8 * 1024 * 1024) throw E('That photo is too large. Try a smaller image.');
  const bytes = Utilities.base64Decode(b64);
  const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
  const blob = Utilities.newBlob(bytes, mime, baseName.replace(/[^\w -]/g, '').slice(0, 40) + '.' + ext);
  const file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (oldFileId) trashDriveFile_(oldFileId);
  return { url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000', fileId: file.getId() };
}

/* ============ EMAIL ============ */
function tpl_(heading, bodyHtml, button) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#12262e">' +
    '<h2 style="margin:0 0 12px">' + esc_(heading) + '</h2>' + bodyHtml +
    (button ? '<p><a href="' + APP_URL + '" style="display:inline-block;background:#1f5f6b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open ' + esc_(APP_NAME) + '</a></p>' : '') +
    '<p style="color:#6b7c83;font-size:12px">' + esc_(APP_NAME) + '</p></div>';
}
function mail_(to, subject, html, replyTo) {
  const list = Array.from(new Set(to.filter(Boolean)));
  if (!list.length) return;
  const opts = { to: list.join(','), subject: subject, htmlBody: html, name: APP_NAME };
  if (replyTo) opts.replyTo = replyTo; // so a reply reaches the admin who actually decided, not just the shared sending account
  try { MailApp.sendEmail(opts); }
  catch (e) { console.error('mail failed: ' + e); }
}
function welcome_(email, name) {
  mail_([email], 'Welcome to ' + APP_NAME,
    tpl_('Welcome, ' + name, '<p>You’ve been added to ' + esc_(APP_NAME) + '. Use it to see when the holiday homes are free and to request a stay.</p>' +
      '<p><b>Signing in:</b> open the link, enter this email address and we’ll send you a 6-digit code.</p>' +
      '<p><b>Notifications (optional):</b> tap “Turn on notifications” under My family.</p>' +
      '<p><b>On iPhone:</b> first open the link in Safari, tap Share, then Add to Home Screen. Open the app from the new icon, then turn on notifications. iPhone needs this for push to work.</p>', true));
}
const familyEmails_ = fid => rows_('Members').filter(m => m.familyId === fid).map(m => m.email);
const adminEmails_ = () => rows_('Members').filter(m => m.role === 'admin').map(m => m.email);

/** Email + push together. Push is best-effort; email is the record. */
function notify_(emails, title, body, html, replyTo) {
  const list = Array.from(new Set(emails));
  mail_(list, title, html, replyTo);
  push_(list, title, body);
}

/* ============ PUSH (FCM HTTP v1 via service account) ============ */
function fcmToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm');
  if (hit) return hit;
  const sa = JSON.parse(prop_('SA_JSON'));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64u_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64u_(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const jwt = unsigned + '.' + b64u_(Utilities.computeRsaSha256Signature(unsigned, sa.private_key));
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  const j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error('FCM auth failed: ' + r.getContentText());
  cache.put('fcm', j.access_token, 3000);
  return j.access_token;
}

/** Returns true if at least one push was accepted. Never throws (push is best-effort). */
function push_(emails, title, body) {
  try {
    if (!prop_('SA_JSON')) return false;
    const tokens = rows_('Tokens').filter(t => emails.indexOf(t.email) >= 0);
    if (!tokens.length) return false;
    const sa = JSON.parse(prop_('SA_JSON'));
    const auth = fcmToken_();
    const url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';
    const reqs = tokens.map(t => ({
      url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + auth },
      payload: JSON.stringify({ message: { token: t.token, data: { title: String(title), body: String(body), url: APP_URL }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } })
    }));
    const res = UrlFetchApp.fetchAll(reqs);
    let ok = false;
    res.forEach((r, i) => {
      const code = r.getResponseCode();
      if (code === 200) ok = true;
      else if (code === 404 || code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText())) del_('Tokens', 'token', tokens[i].token);
      else console.error('push failed ' + code + ' ' + r.getContentText());
    });
    return ok;
  } catch (e) { console.error('push error: ' + e); return false; }
}
