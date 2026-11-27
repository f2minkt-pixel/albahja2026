/*
 * Al Bahja — shared core logic.
 *
 * This exact file runs in two places:
 *   1. In the browser (demo mode, data kept in localStorage) — al-bahja-portal/core.js
 *   2. In Google Apps Script (live mode, data kept in Google Sheets) — apps-script/Core.gs
 * Keep both copies identical. No passwords live here — they are passed in via env.secrets.
 *
 * db  = { load(tab) -> [rowObj], save(tab, rows), append(tab, rows) }
 * env = { now(), uuid(), random(), withLock(fn), session:{get,put,incr}, secrets, sendMail(subject,text,html), sheetUrl() }
 */
var AB = (function () {
  'use strict';

  var CLASSES = ['CRE', 'Class 7', 'Class 6', 'Class 5', 'Class 4', 'Class 3', 'Class 2', 'Class 1', 'Rawdha 2', 'Rawdha 1'];
  var GROUPS = ['Senior (Age 14+)', 'Junior (Age 11-13)', 'Sub-Junior (Age 8-10)', 'Kids (Age 5-7)'];
  var GENDERS = ['Boys', 'Girls'];
  // Rawdha (KG): Rawdha 1 & 2. Registration is the same form; for results and viewing, Rawdha boys
  // and girls (all ages) form one combined section. Rawdha has no sports.
  var RAWDHA_CLASSES = ['Rawdha 2', 'Rawdha 1'];
  var RAWDHA_GROUP = 'Rawdha (Rawdha 1 & 2)';
  var ALL_GROUPS = GROUPS.concat([RAWDHA_GROUP]);
  var SECTIONS = ['Boys', 'Girls', 'Rawdha'];
  var PROGRAM_STATUS = ['Open', 'Completed'];
  function isRawdha(cls) { return RAWDHA_CLASSES.indexOf(cls) >= 0; }
  /** Viewing/competition section of a registration or entry: Boys, Girls, or Rawdha (mixed). */
  function sectionOf(x) { return isRawdha(x.cls) ? 'Rawdha' : x.gender; }
  /** Competition group: Rawdha is one combined group regardless of age group. */
  function compGroup(x) { return isRawdha(x.cls) ? RAWDHA_GROUP : x.group; }
  var SPORTS = ['Football', 'VolleyBall', 'Tug of War', 'Arm Wrestling', 'Sack Race', 'Lemon & Spoon',
    'Musical Chair (Without Music)', 'Kabaddi'];
  var ARTS_BOYS = ['Skit', 'Speech - English', 'Speech - Malayalam', 'Speech - Arabic', 'Song - Malayalam',
    'Song - Arabic', 'Group Song - Arabic', 'Group Song - Malayalam', 'Story Telling', 'Quran Recitation', 'Mime'];
  var ARTS_GIRLS = ['Islamic Speech - Malayalam', 'Islamic Speech - Arabic', 'Islamic Speech - English', 'Islamic Song - Malayalam', 'Islamic Song - Arabic', 'Islamic Song - English', 'Group Song',
    'Story Telling', 'Action Song', 'Dua', 'Hadees', 'Quran Recitation', 'Skit',
    'Quran Recitation with Translation', 'Hadees with Translation'];
  var ARTS_RAWDHA = ARTS_GIRLS.slice(); // Rawdha uses the girls' Arts list, open to boys and girls.
  // Every arts item once; boys' items keep codes A01–A11, girls-only items follow (A12+).
  var ARTS_ALL = ARTS_BOYS.concat(ARTS_GIRLS.filter(function (x) { return ARTS_BOYS.indexOf(x) < 0; }));
  var MAX_PER_CATEGORY = 3;
  var SCREENING = ['Confirmed Reg', 'Screening Pending', 'Need Practice', 'Selected for Program'];
  var PRESENT = 'Present', ABSENT = 'Not Present', CHECKED_OUT = 'Checked Out';
  var POINTS = { 1: 5, 2: 3, 3: 1 };

  function programCode(program) {
    var i = SPORTS.indexOf(program);
    if (i >= 0) return 'S' + pad2(i + 1);
    i = ARTS_ALL.indexOf(program);
    if (i >= 0) return 'A' + pad2(i + 1);
    return 'X';
  }
  function categoryOf(program) { return SPORTS.indexOf(program) >= 0 ? 'Sports' : 'Arts'; }
  function allPrograms() { return SPORTS.concat(ARTS_ALL); }
  /** Which sections (Boys / Girls / Rawdha) can enter a program. */
  function gendersFor(program) {
    var g = [];
    if (SPORTS.indexOf(program) >= 0 || ARTS_BOYS.indexOf(program) >= 0) g.push('Boys');
    if (ARTS_GIRLS.indexOf(program) >= 0) g.push('Girls');
    if (ARTS_RAWDHA.indexOf(program) >= 0) g.push('Rawdha');
    return g;
  }
  /** Items a student may choose. */
  function artsFor(gender, cls) { return isRawdha(cls) ? ARTS_RAWDHA : gender === 'Boys' ? ARTS_BOYS : ARTS_GIRLS; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var SCHEMA = {
    Registrations: [['ts', 'Timestamp'], ['chest', 'Chest No'], ['name', 'Name'], ['gender', 'Gender'],
      ['cls', 'Class'], ['group', 'Group'], ['phone', 'Parent Phone'], ['sports', 'Sports Items'],
      ['arts', 'Arts Items'], ['checkin', 'Check-In Status'], ['notes', 'Volunteer Notes'],
      ['checkinBy', 'Checked In By'], ['checkinAt', 'Check-In Time'], ['checkoutBy', 'Checked Out By'],
      ['checkoutAt', 'Check-Out Time'], ['guests', 'People With Them']],
    Program_Assignments: [['entry', 'Entry ID'], ['chest', 'Chest No'], ['name', 'Student Name'],
      ['gender', 'Gender'], ['cls', 'Class'], ['group', 'Group'], ['program', 'Program Name'],
      ['category', 'Category'], ['screening', 'Screening Status'], ['checkin', 'Check-In Status'],
      ['screenedBy', 'Screened By']],
    Scores: [['program', 'Program Name'], ['group', 'Group'], ['chest', 'Chest No'], ['name', 'Student Name'],
      ['judge', 'Judge Name'], ['score', 'Score'], ['remarks', 'Remarks'], ['ts', 'Timestamp']],
    Live_Leaderboard: [['program', 'Program Name'], ['category', 'Category'], ['gender', 'Gender'],
      ['group', 'Group'], ['rank', 'Rank'], ['chest', 'Chest No'], ['name', 'Student Name'], ['cls', 'Class'],
      ['avg', 'Average Score'], ['total', 'Total Score'], ['judges', 'Judges'], ['updated', 'Updated']],
    Staff_Logs: [['role', 'Role'], ['name', 'Name'], ['phone', 'Phone'], ['ts', 'Login Time'], ['detail', 'Detail']],
    Program_Status: [['program', 'Program Name'], ['section', 'Section'], ['group', 'Group'], ['status', 'Status'],
      ['by', 'Marked By'], ['ts', 'Time']],
    Judge_Codes: [['program', 'Program Name'], ['code', 'Judge Code'], ['updated', 'Updated']]
  };

  /** Each program has its own 6-digit judge code. Missing codes are created automatically. */
  function newCode(used, rnd) {
    for (var i = 0; i < 1000; i++) { var c = String(100000 + Math.floor(rnd() * 900000)); if (!used[c]) return c; }
    fail('Could not create a judge code.');
  }
  // All sports events share one judge code; each Arts item has its own.
  var ALL_SPORTS = 'All Sports';
  function codeKey(program) { return SPORTS.indexOf(program) >= 0 || program === ALL_SPORTS ? ALL_SPORTS : program; }
  function codeKeys() { return [ALL_SPORTS].concat(ARTS_ALL); }
  /** Programs a judge session may score: all sports events for the sports code, else just its program. */
  function judgePrograms(s) { return codeKey(s.program) === ALL_SPORTS ? SPORTS.slice() : [s.program]; }
  function judgeCodes(db, env) {
    var rows = db.load('Judge_Codes'), keep = [], have = {}, used = {}, changed = false, sportsCode = '';
    rows.forEach(function (r) {
      if (SPORTS.indexOf(r.program) >= 0) { if (!sportsCode) sportsCode = String(r.code); changed = true; return; } // old per-sport codes
      keep.push(r); have[r.program] = 1; used[String(r.code)] = 1;
    });
    codeKeys().forEach(function (k) {
      if (have[k]) return;
      var c = (k === ALL_SPORTS && sportsCode && !used[sportsCode]) ? sportsCode : newCode(used, env.random); used[c] = 1;
      keep.push({ program: k, code: c, updated: env.now() }); changed = true;
    });
    if (changed) db.save('Judge_Codes', keep);
    return keep;
  }
  function statusKey(program, section, group) { return program + '|' + section + '|' + group; }
  function statusMap(rows) { var m = {}; rows.forEach(function (r) { m[statusKey(r.program, r.section, r.group)] = r; }); return m; }

  // ---------- helpers ----------
  /** Full name = at least two words, each with 2+ letters (e.g. "Fathima Rahman"). */
  function isFullName(s) {
    var words = String(s || '').replace(/[.\-']/g, ' ').trim().split(/\s+/)
      .filter(function (w) { return w.replace(/[^\p{L}]/gu, '').length >= 2; });
    return words.length >= 2;
  }
  /** Name key for duplicate checks: ignores case, extra spaces and dots. */
  function nameKey(s) { return String(s || '').toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function fail(msg) { var e = new Error(msg); e.userFacing = true; throw e; }
  function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 120); }
  function normPhone(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function validPhone(p) { return /^\d{9,15}$/.test(p); }
  function splitItems(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function same(a, b) { return String(a) === String(b); }
  function uniq(arr) { var o = []; (arr || []).forEach(function (x) { x = String(x); if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Chest numbers never mix: boys 100–499, girls 500–999 (overflow: boys 1000–1499, girls 1500–1999).
  var CHEST_RANGES = { Boys: [[100, 499], [1000, 1499]], Girls: [[500, 999], [1500, 1999]] };
  function pickChest(used, rnd, gender) {
    var ranges = CHEST_RANGES[gender] || CHEST_RANGES.Boys;
    for (var r = 0; r < ranges.length; r++) {
      var lo = ranges[r][0], hi = ranges[r][1], free = [];
      for (var n = lo; n <= hi; n++) if (!used.has(String(n))) free.push(n);
      if (free.length) return free[Math.floor(rnd() * free.length)];
    }
    fail('All chest numbers for ' + gender + ' are used. Please contact the organisers.');
  }

  // ---------- results ----------
  /** Ranks every program/gender/group bucket by average judge score. */
  function computeResults(assignments, scores) {
    var byEntry = {};
    scores.forEach(function (s) {
      var k = s.program + '|' + s.chest;
      var v = Number(s.score);
      if (isNaN(v)) return;
      (byEntry[k] = byEntry[k] || []).push(v);
    });
    var buckets = {};
    assignments.forEach(function (a) {
      var list = byEntry[a.program + '|' + a.chest];
      if (!list || !list.length) return;
      var total = list.reduce(function (x, y) { return x + y; }, 0);
      var sec = sectionOf(a), grp = compGroup(a); // Rawdha boys & girls share one bucket
      var key = a.program + '|' + sec + '|' + grp;
      var b = buckets[key] = buckets[key] || { program: a.program, category: a.category || categoryOf(a.program), gender: sec, group: grp, entries: [] };
      b.entries.push({ chest: a.chest, name: a.name, cls: a.cls, group: a.group, gender: a.gender, total: round2(total), avg: round2(total / list.length), judges: list.length });
    });
    var out = Object.keys(buckets).map(function (k) { return buckets[k]; });
    out.forEach(function (b) {
      b.entries.sort(function (x, y) { return y.avg - x.avg || y.total - x.total || Number(x.chest) - Number(y.chest); });
      b.entries.forEach(function (e) {
        e.rank = 1 + b.entries.filter(function (o) { return o.avg > e.avg; }).length;
      });
    });
    out.sort(function (x, y) {
      return x.category.localeCompare(y.category) || allPrograms().indexOf(x.program) - allPrograms().indexOf(y.program) ||
        SECTIONS.indexOf(x.gender) - SECTIONS.indexOf(y.gender) || ALL_GROUPS.indexOf(x.group) - ALL_GROUPS.indexOf(y.group);
    });
    return out;
  }

  /** Class points table from (possibly filtered) result buckets. 1st=5, 2nd=3, 3rd=1. */
  function classBoard(results) {
    var t = {};
    results.forEach(function (b) {
      b.entries.forEach(function (e) {
        if (e.rank > 3) return;
        var r = t[e.cls] = t[e.cls] || { cls: e.cls, points: 0, first: 0, second: 0, third: 0 };
        r.points += POINTS[e.rank];
        r[['', 'first', 'second', 'third'][e.rank]]++;
      });
    });
    return Object.keys(t).map(function (k) { return t[k]; })
      .sort(function (a, b) { return b.points - a.points || b.first - a.first || b.second - a.second; });
  }

  /** Individual points (top performers) from result buckets. */
  function starBoard(results) {
    var t = {};
    results.forEach(function (b) {
      b.entries.forEach(function (e) {
        if (e.rank > 3) return;
        var r = t[e.chest] = t[e.chest] || { chest: e.chest, name: e.name, cls: e.cls, group: e.group, gender: e.gender, points: 0, wins: [] };
        r.points += POINTS[e.rank];
        r.wins.push(b.program + ' (' + e.rank + ')');
      });
    });
    return Object.keys(t).map(function (k) { return t[k]; }).sort(function (a, b) { return b.points - a.points; });
  }

  function rebuildLeaderboard(db, env) {
    var res = computeResults(db.load('Program_Assignments'), db.load('Scores'));
    var now = env.now(), rows = [];
    res.forEach(function (b) {
      b.entries.forEach(function (e) {
        rows.push({ program: b.program, category: b.category, gender: b.gender, group: b.group, rank: e.rank, chest: e.chest, name: e.name, cls: e.cls, avg: e.avg, total: e.total, judges: e.judges, updated: now });
      });
    });
    db.save('Live_Leaderboard', rows);
  }

  // ---------- actions ----------
  function register(db, env, p) {
    var name = clean(p.name, 80), gender = p.gender, cls = p.cls, group = p.group, phone = normPhone(p.phone);
    if (!isFullName(name)) fail('Please enter the student\'s full name (first name and family name).');
    if (GENDERS.indexOf(gender) < 0) fail('Please choose Boys or Girls.');
    if (!validPhone(phone)) fail('Please enter a valid parent phone number (9–15 digits).');
    if (CLASSES.indexOf(cls) < 0) fail('Please choose the class in Madrasa.');
    if (GROUPS.indexOf(group) < 0) fail('Please choose the age group.');
    var sports = uniq(p.sports), arts = uniq(p.arts);
    if (gender === 'Girls' && sports.length) fail('Sports items are open to boys only.');
    if (isRawdha(cls) && sports.length) fail('Rawdha has Arts items only.');
    var artsList = artsFor(gender, cls);
    sports.forEach(function (s) { if (SPORTS.indexOf(s) < 0) fail('Unknown sports item: ' + s); });
    arts.forEach(function (s) { if (artsList.indexOf(s) < 0) fail('Item not available: ' + s); });
    if (sports.length > MAX_PER_CATEGORY) fail('Maximum 3 Sports items.');
    if (arts.length > MAX_PER_CATEGORY) fail('Maximum 3 Arts items.');
    if (!sports.length && !arts.length) fail('Please select at least one item.');

    var regs = db.load('Registrations');
    // Same phone is fine (siblings); only the same name AND the same phone is a duplicate.
    var dup = regs.filter(function (r) { return same(normPhone(r.phone), phone) && nameKey(r.name) === nameKey(name); })[0];
    if (dup) fail(name + ' is already registered with this phone number (Chest No ' + dup.chest + ').');

    var used = {}; regs.forEach(function (r) { used[String(r.chest)] = 1; });
    var chest = pickChest({ has: function (k) { return !!used[k]; } }, env.random, gender);
    var ts = env.now();
    var reg = { ts: ts, chest: chest, name: name, gender: gender, cls: cls, group: group, phone: phone,
      sports: sports.join(', '), arts: arts.join(', '), checkin: ABSENT, notes: '', checkinBy: '', checkinAt: '' };
    var entries = sports.map(function (s) { return [s, 'Sports']; }).concat(arts.map(function (s) { return [s, 'Arts']; }))
      .map(function (x) {
        return { entry: chest + '-' + programCode(x[0]), chest: chest, name: name, gender: gender, cls: cls, group: group,
          program: x[0], category: x[1], screening: SCREENING[0], checkin: ABSENT, screenedBy: '' };
      });
    db.append('Registrations', [reg]);
    db.append('Program_Assignments', entries);

    var emailed = true;
    try {
      var lines = ['New Al Bahja registration', '', 'Chest No: ' + chest, 'Name: ' + name, 'Gender: ' + gender,
        'Class: ' + cls, 'Group: ' + group, 'Parent Phone: ' + phone,
        'Sports: ' + (sports.join(', ') || '—'), 'Arts: ' + (arts.join(', ') || '—'), '', 'Entries:'];
      entries.forEach(function (e) { lines.push('  ' + e.entry + '  ' + e.program + ' (' + e.category + ')'); });
      lines.push('', 'Registered: ' + ts);
      env.sendMail('Al Bahja Registration — Chest ' + chest + ' — ' + name, lines.join('\n'));
    } catch (e) { emailed = false; }

    return { ok: true, emailed: emailed, receipt: { reg: reg, entries: entries } };
  }

  function login(db, env, p) {
    var role = p.role, sec = env.secrets || {}, name = clean(p.name, 60), phone = normPhone(p.phone);
    var guardKey = 'fail:' + role;
    if ((env.session.incr ? env.session.incr(guardKey, 0) : 0) >= 25) fail('Too many failed attempts. Please wait 10 minutes.');
    function bad(msg) { if (env.session.incr) env.session.incr(guardKey, 1); fail(msg); }
    var sess = { role: role, name: name, phone: phone };
    var detail = '';
    if (role === 'admin') {
      if (clean(p.user) !== sec.adminUser || String(p.pass || '') !== sec.adminPass) bad('Incorrect username or password.');
      sess.name = 'Admin';
    } else if (role === 'teacher') {
      if (name.length < 2) fail('Please enter your name.');
      if (!validPhone(phone)) fail('Please enter a valid phone number.');
      if (String(p.code || '').trim() !== sec.teacherCode) bad('Incorrect special access code.');
    } else if (role === 'volunteer') {
      if (name.length < 2) fail('Please enter your name.');
      if (!validPhone(phone)) fail('Please enter a valid phone number.');
      if (sec.volunteerCode && String(p.code || '').trim() !== sec.volunteerCode) bad('Incorrect check-in code.');
    } else if (role === 'judge') {
      if (name.length < 2) fail('Please enter your name.');
      if (allPrograms().indexOf(p.program) < 0) fail('Please choose the program you are judging.');
      var jc = judgeCodes(db, env).filter(function (r) { return r.program === codeKey(p.program); })[0];
      if (!jc || String(p.code || '').trim() !== String(jc.code)) bad('Incorrect code for ' + p.program + '. Ask the organisers for this program\'s code.');
      sess.program = p.program;
      detail = 'Program: ' + p.program;
    } else fail('Unknown role.');
    var token = env.uuid();
    env.session.put(token, sess);
    db.append('Staff_Logs', [{ role: role.charAt(0).toUpperCase() + role.slice(1), name: sess.name, phone: phone, ts: env.now(), detail: detail }]);
    return { ok: true, token: token, role: role, name: sess.name, program: sess.program || '' };
  }

  function data(db, env, s) {
    var assigns = db.load('Program_Assignments');
    var out = { ok: true, role: s.role, name: s.name, program: s.program || '' };
    if (s.role === 'judge') {
      // Judges see chest numbers only (blind judging), and only their own marks.
      var mine = judgePrograms(s);
      out.programs = mine;
      out.assignments = assigns.filter(function (a) { return mine.indexOf(a.program) >= 0; })
        .map(function (a) { return { entry: a.entry, chest: a.chest, gender: a.gender, cls: a.cls, group: a.group, program: a.program, category: a.category, screening: a.screening, checkin: a.checkin }; });
      out.scores = db.load('Scores').filter(function (x) { return x.judge === s.name && mine.indexOf(x.program) >= 0; });
      out.programStatus = db.load('Program_Status').filter(function (x) { return mine.indexOf(x.program) >= 0; });
      return out;
    }
    out.assignments = assigns;
    out.registrations = db.load('Registrations');
    out.programStatus = db.load('Program_Status');
    if (s.role === 'admin') {
      out.scores = db.load('Scores');
      out.staffLogs = db.load('Staff_Logs');
      out.sheetUrl = env.sheetUrl ? env.sheetUrl() : '';
      out.judgeCodes = judgeCodes(db, env);
    }
    return out;
  }

  function screen(db, env, s, p) {
    if (SCREENING.indexOf(p.status) < 0) fail('Unknown screening status.');
    var rows = db.load('Program_Assignments'), hit = 0;
    rows.forEach(function (r) { if (same(r.entry, p.entry)) { r.screening = p.status; r.screenedBy = s.name; hit++; } });
    if (!hit) fail('Entry not found.');
    db.save('Program_Assignments', rows);
    return { ok: true };
  }

  /** Attendance: Not Present -> Present (check in) -> Checked Out (check out); check in again if they return. */
  /** Bulk: set one screening status on many entries in a single save. */
  function screenMany(db, env, s, p) {
    if (SCREENING.indexOf(p.status) < 0) fail('Unknown screening status.');
    var want = {}; (p.entries || []).forEach(function (e) { want[String(e)] = 1; });
    var n = Object.keys(want).length;
    if (!n) fail('Tick at least one entry.');
    if (n > 500) fail('Please change at most 500 entries at a time.');
    var rows = db.load('Program_Assignments'), hit = 0;
    rows.forEach(function (r) { if (want[String(r.entry)]) { r.screening = p.status; r.screenedBy = s.name; hit++; } });
    if (!hit) fail('Entries not found.');
    db.save('Program_Assignments', rows);
    return { ok: true, changed: hit };
  }

  /** Admin: give a program a new judge code (random, or a chosen 4–8 digit code). */
  function setJudgeCode(db, env, s, p) {
    var key = codeKey(p.program);
    if (codeKeys().indexOf(key) < 0) fail('Unknown program.');
    var rows = judgeCodes(db, env), used = {};
    rows.forEach(function (r) { if (r.program !== key) used[String(r.code)] = 1; });
    var code = p.code ? String(p.code).trim() : newCode(used, env.random);
    if (!/^\d{4,8}$/.test(code)) fail('Code must be 4 to 8 digits.');
    if (used[code]) fail('That code is already used by another program.');
    rows.forEach(function (r) { if (r.program === key) { r.code = code; r.updated = env.now(); } });
    db.save('Judge_Codes', rows);
    return { ok: true, code: code };
  }

  function checkin(db, env, s, p) {
    var status = p.status === PRESENT ? PRESENT : p.status === CHECKED_OUT ? CHECKED_OUT : ABSENT;
    var regs = db.load('Registrations'), reg = null;
    regs.forEach(function (r) {
      if (!same(r.chest, p.chest)) return;
      reg = r;
      // Once checked in, volunteers can only check out; only Admin can undo a check-in.
      if (r.checkin === PRESENT && status === ABSENT && s.role !== 'admin') fail('Chest ' + r.chest + ' is already checked in. Use Check out.');
      // Check-out is final: only Admin can change it afterwards (to fix a mistake).
      if (r.checkin === CHECKED_OUT && s.role !== 'admin') fail('Chest ' + r.chest + ' is already checked out.');
      if (status === CHECKED_OUT && r.checkin !== PRESENT) fail('Chest ' + r.chest + ' is not checked in.');
      r.checkin = status;
      if (status === PRESENT) { r.checkinBy = s.name; r.checkinAt = env.now(); r.checkoutBy = ''; r.checkoutAt = ''; }
      else if (status === CHECKED_OUT) { r.checkoutBy = s.name; r.checkoutAt = env.now(); }
      else { r.checkinBy = s.name; r.checkinAt = ''; r.checkoutBy = ''; r.checkoutAt = ''; }
    });
    if (!reg) fail('Chest number not found.');
    // Log the change with time and who did it in the notes, plus any note typed with it.
    var what = status === PRESENT ? 'Checked in' : status === CHECKED_OUT ? 'Checked out' : 'Marked not present';
    if (status === PRESENT && p.guests != null && p.guests !== '') reg.guests = guestCount(p.guests);
    var extra = clean(p.note, 300);
    var line = '[' + env.now().slice(5, 16) + ' ' + s.name + '] ' + what + (extra ? ' — ' + extra : '');
    reg.notes = reg.notes ? reg.notes + '\n' + line : line;
    db.save('Registrations', regs);
    var rows = db.load('Program_Assignments');
    rows.forEach(function (r) { if (same(r.chest, p.chest)) r.checkin = status; });
    db.save('Program_Assignments', rows);
    return { ok: true, status: status };
  }

  function guestCount(v) {
    var n = Math.floor(Number(v));
    if (isNaN(n) || n < 0 || n > 30) fail('People with them must be a number from 0 to 30.');
    return n;
  }
  /** How many people came with the child (parents, siblings not competing). Counted in the headcount while checked in. */
  function setGuests(db, env, s, p) {
    var n = guestCount(p.guests), regs = db.load('Registrations'), hit = false;
    regs.forEach(function (r) { if (same(r.chest, p.chest)) { r.guests = n; hit = true; } });
    if (!hit) fail('Chest number not found.');
    db.save('Registrations', regs);
    return { ok: true, guests: n };
  }

  function note(db, env, s, p) {
    var text = clean(p.note, 300);
    if (!text) fail('Note is empty.');
    var regs = db.load('Registrations'), hit = false;
    regs.forEach(function (r) {
      if (same(r.chest, p.chest)) {
        hit = true;
        var line = '[' + env.now().slice(5, 16) + ' ' + s.name + '] ' + text;
        r.notes = r.notes ? r.notes + '\n' + line : line;
      }
    });
    if (!hit) fail('Chest number not found.');
    db.save('Registrations', regs);
    return { ok: true };
  }

  function score(db, env, s, p) {
    var program = s.role === 'judge' ? (p.program || s.program) : p.program;
    if (s.role === 'judge' && judgePrograms(s).indexOf(program) < 0) fail('Your judge code is not for ' + program + '.');
    var judge = s.role === 'judge' ? s.name : clean(p.judgeName || 'Admin', 60);
    if (allPrograms().indexOf(program) < 0) fail('Unknown program.');
    var assigns = db.load('Program_Assignments').filter(function (a) { return a.program === program; });
    var list = (p.entries || []).filter(function (e) { return e && e.score !== '' && e.score != null; });
    if (!list.length) fail('Enter at least one score.');
    var scores = db.load('Scores'), now = env.now();
    list.forEach(function (e) {
      var a = assigns.filter(function (x) { return same(x.chest, e.chest); })[0];
      if (!a) fail('Chest ' + e.chest + ' is not registered for ' + program + '.');
      var v = Number(e.score);
      if (isNaN(v) || v < 0 || v > 100) fail('Score for chest ' + e.chest + ' must be between 0 and 100.');
      var row = { program: program, group: a.group, chest: a.chest, name: a.name, judge: judge, score: round2(v), remarks: clean(e.remarks, 200), ts: now };
      var i = -1;
      scores.forEach(function (x, j) { if (x.program === program && same(x.chest, a.chest) && x.judge === judge) i = j; });
      if (i >= 0) scores[i] = row; else scores.push(row);
    });
    db.save('Scores', scores);
    rebuildLeaderboard(db, env);
    return { ok: true, saved: list.length };
  }

  function updateReg(db, env, s, p) {
    var patch = p.patch || {}, regs = db.load('Registrations'), reg = null;
    regs.forEach(function (r) { if (same(r.chest, p.chest)) reg = r; });
    if (!reg) fail('Chest number not found.');
    if (patch.name != null) { var n = clean(patch.name, 80); if (!isFullName(n)) fail('Please enter the full name (first name and family name).'); reg.name = n; }
    if (patch.phone != null) { var ph = normPhone(patch.phone); if (!validPhone(ph)) fail('Invalid phone.'); reg.phone = ph; }
    if (patch.cls != null) { if (CLASSES.indexOf(patch.cls) < 0) fail('Invalid class.'); reg.cls = patch.cls; }
    if (patch.group != null) { if (GROUPS.indexOf(patch.group) < 0) fail('Invalid group.'); reg.group = patch.group; }
    if (patch.notes != null) reg.notes = String(patch.notes).slice(0, 2000);
    db.save('Registrations', regs);
    var rows = db.load('Program_Assignments');
    rows.forEach(function (r) { if (same(r.chest, p.chest)) { r.name = reg.name; r.cls = reg.cls; r.group = reg.group; } });
    db.save('Program_Assignments', rows);
    var sc = db.load('Scores');
    sc.forEach(function (r) { if (same(r.chest, p.chest)) { r.name = reg.name; r.group = reg.group; } });
    db.save('Scores', sc);
    stripRawdhaSports(db);
    rebuildLeaderboard(db, env);
    return { ok: true };
  }

  /** Rawdha has no sports: remove sports items (entries and their marks) from Rawdha registrations. */
  function stripRawdhaSports(db) {
    var regs = db.load('Registrations'), chests = {}, removed = 0;
    regs.forEach(function (r) { if (isRawdha(r.cls) && r.sports) { chests[String(r.chest)] = 1; r.sports = ''; } });
    if (!Object.keys(chests).length) return 0;
    db.save('Registrations', regs);
    var drop = function (a) { return chests[String(a.chest)] && SPORTS.indexOf(a.program) >= 0; };
    var pa = db.load('Program_Assignments');
    removed = pa.filter(drop).length;
    db.save('Program_Assignments', pa.filter(function (a) { return !drop(a); }));
    db.save('Scores', db.load('Scores').filter(function (x) { return !drop(x); }));
    return removed;
  }
  function cleanupRawdha(db, env) {
    var n = stripRawdhaSports(db);
    rebuildLeaderboard(db, env);
    return { ok: true, removedEntries: n };
  }

  function deleteReg(db, env, s, p) {
    var keep = function (r) { return !same(r.chest, p.chest); };
    var regs = db.load('Registrations');
    if (regs.filter(keep).length === regs.length) fail('Chest number not found.');
    db.save('Registrations', regs.filter(keep));
    db.save('Program_Assignments', db.load('Program_Assignments').filter(keep));
    db.save('Scores', db.load('Scores').filter(keep));
    rebuildLeaderboard(db, env);
    return { ok: true };
  }

  function deleteScore(db, env, s, p) {
    db.save('Scores', db.load('Scores').filter(function (r) {
      return !(r.program === p.program && same(r.chest, p.chest) && r.judge === p.judge);
    }));
    rebuildLeaderboard(db, env);
    return { ok: true };
  }

  /** Tag a program (per section + age group) as Completed or Open again. Label only — marks stay editable. */
  function setStatus(db, env, s, p) {
    var program = s.role === 'judge' ? (p.program || s.program) : p.program;
    if (s.role === 'judge' && judgePrograms(s).indexOf(program) < 0) fail('Your judge code is not for ' + program + '.');
    if (allPrograms().indexOf(program) < 0) fail('Unknown program.');
    if (SECTIONS.indexOf(p.section) < 0) fail('Choose Boys, Girls or Rawdha first.');
    if (ALL_GROUPS.indexOf(p.group) < 0) fail('Choose one age group first.');
    if (PROGRAM_STATUS.indexOf(p.status) < 0) fail('Unknown status.');
    var rows = db.load('Program_Status'), k = statusKey(program, p.section, p.group), hit = false;
    var row = { program: program, section: p.section, group: p.group, status: p.status, by: s.name, ts: env.now() };
    rows.forEach(function (r, i) { if (statusKey(r.program, r.section, r.group) === k) { rows[i] = row; hit = true; } });
    if (!hit) rows.push(row);
    db.save('Program_Status', rows);
    return { ok: true, status: row };
  }

  /** Every program that has entries, per section + competition group, with Pending/Completed status. */
  function programList(assigns, scores, statusRows) {
    var st = statusMap(statusRows), scored = {}, t = {};
    (scores || []).forEach(function (x) { scored[x.program + '|' + x.chest] = 1; });
    assigns.forEach(function (a) {
      var sec = sectionOf(a), grp = compGroup(a), k = statusKey(a.program, sec, grp);
      var r = t[k] = t[k] || { program: a.program, category: a.category || categoryOf(a.program), section: sec, group: grp, entries: 0, scored: scores ? 0 : null };
      r.entries++;
      if (scores && scored[a.program + '|' + a.chest]) r.scored++;
    });
    return Object.keys(t).map(function (k) {
      var r = t[k], s = st[k];
      r.status = s && s.status === 'Completed' ? 'Completed' : 'Pending';
      r.by = s && s.status === 'Completed' ? s.by : '';
      r.ts = s && s.status === 'Completed' ? s.ts : '';
      return r;
    }).sort(function (x, y) {
      return x.category.localeCompare(y.category) || allPrograms().indexOf(x.program) - allPrograms().indexOf(y.program) ||
        SECTIONS.indexOf(x.section) - SECTIONS.indexOf(y.section) || ALL_GROUPS.indexOf(x.group) - ALL_GROUPS.indexOf(y.group);
    });
  }

  function scoreboard(db) {
    var assigns = db.load('Program_Assignments'), scores = db.load('Scores'), statusRows = db.load('Program_Status');
    var res = computeResults(assigns, scores);
    var st = statusMap(statusRows);
    // Public view: podium only (top 3), no phone numbers.
    res.forEach(function (b) {
      b.entries = b.entries.filter(function (e) { return e.rank <= 3; });
      var r = st[statusKey(b.program, b.gender, b.group)];
      b.completed = !!(r && r.status === 'Completed');
    });
    var programs = programList(assigns, scores, statusRows).map(function (p) { delete p.by; return p; });
    return { ok: true, results: res, programs: programs };
  }

  var WRITES = { register: 1, login: 1, screen: 1, checkin: 1, note: 1, score: 1, updateReg: 1, deleteReg: 1, deleteScore: 1, setStatus: 1, cleanupRawdha: 1, setGuests: 1, screenMany: 1, setJudgeCode: 1 };
  var ROLES = {
    data: ['admin', 'teacher', 'volunteer', 'judge'],
    screen: ['admin', 'teacher'], screenMany: ['admin', 'teacher'],
    checkin: ['admin', 'volunteer'],
    note: ['admin', 'volunteer'],
    score: ['admin', 'judge'],
    updateReg: ['admin'], deleteReg: ['admin'], deleteScore: ['admin'],
    setStatus: ['admin', 'judge', 'teacher'], cleanupRawdha: ['admin'], setGuests: ['admin', 'volunteer'], setJudgeCode: ['admin']
  };
  var FNS = { data: data, screen: screen, screenMany: screenMany, setJudgeCode: setJudgeCode, checkin: checkin, note: note, score: score, updateReg: updateReg, deleteReg: deleteReg, deleteScore: deleteScore, setStatus: setStatus, cleanupRawdha: cleanupRawdha, setGuests: setGuests };

  function handle(db, env, action, p) {
    p = p || {};
    try {
      var run = function () {
        if (action === 'register') return register(db, env, p);
        if (action === 'login') return login(db, env, p);
        if (action === 'scoreboard') return scoreboard(db);
        if (!FNS[action]) fail('Unknown action.');
        var s = p.token ? env.session.get(p.token) : null;
        if (!s) return { ok: false, auth: true, error: 'Your session has expired. Please log in again.' };
        if (ROLES[action].indexOf(s.role) < 0) return { ok: false, error: 'Your role is not allowed to do this.' };
        return FNS[action](db, env, s, p);
      };
      return WRITES[action] ? env.withLock(run) : run();
    } catch (e) {
      return { ok: false, error: e.userFacing ? e.message : 'Server error: ' + (e && e.message || e) };
    }
  }

  return {
    CLASSES: CLASSES, GROUPS: GROUPS, GENDERS: GENDERS, SPORTS: SPORTS, ARTS_BOYS: ARTS_BOYS, ARTS_GIRLS: ARTS_GIRLS, ARTS_ALL: ARTS_ALL, gendersFor: gendersFor,
    MAX_PER_CATEGORY: MAX_PER_CATEGORY, SCREENING: SCREENING, PRESENT: PRESENT, ABSENT: ABSENT, CHECKED_OUT: CHECKED_OUT, POINTS: POINTS,
    SCHEMA: SCHEMA, programCode: programCode, categoryOf: categoryOf, allPrograms: allPrograms, splitItems: splitItems,
    computeResults: computeResults, classBoard: classBoard, starBoard: starBoard, handle: handle,
    isFullName: isFullName, RAWDHA_CLASSES: RAWDHA_CLASSES, RAWDHA_GROUP: RAWDHA_GROUP, ALL_GROUPS: ALL_GROUPS,
    SECTIONS: SECTIONS, ARTS_RAWDHA: ARTS_RAWDHA, isRawdha: isRawdha, sectionOf: sectionOf, artsFor: artsFor,
    ALL_SPORTS: ALL_SPORTS, codeKey: codeKey, codeKeys: codeKeys, statusKey: statusKey, statusMap: statusMap, compGroup: compGroup, programList: programList
  };
})();
