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

  var CLASSES = ['CRE', 'Class 7', 'Class 6', 'Class 5', 'Class 4', 'Class 3', 'Class 2', 'Class 1'];
  var GROUPS = ['Senior (Age 14+)', 'Junior (Age 11-13)', 'Sub-Junior (Age 8-10)', 'Kids (Age 5-7)'];
  var GENDERS = ['Boys', 'Girls'];
  var SPORTS = ['Football', 'VolleyBall', 'Tug of War', 'Arm Wrestling', 'Sack Race', 'Lemon & Spoon',
    'Musical Chair (Without Music)', 'Kabaddi'];
  var ARTS_BOYS = ['Skit', 'Speech - English', 'Speech - Malayalam', 'Speech - Arabic', 'Song - Malayalam',
    'Song - Arabic', 'Group Song - Arabic', 'Group Song - Malayalam', 'Story Telling', 'Quran Recitation', 'Mime'];
  var ARTS_GIRLS = ['Islamic Speech - Malayalam', 'Islamic Speech - Arabic', 'Islamic Speech - English', 'Islamic Song - Malayalam', 'Islamic Song - Arabic', 'Islamic Song - English', 'Group Song',
    'Story Telling', 'Action Song', 'Dua', 'Hadees', 'Quran Recitation', 'Skit',
    'Quran Recitation with Translation', 'Hadees with Translation'];
  // Every arts item once; boys' items keep codes A01–A11, girls-only items follow (A12+).
  var ARTS_ALL = ARTS_BOYS.concat(ARTS_GIRLS.filter(function (x) { return ARTS_BOYS.indexOf(x) < 0; }));
  var MAX_PER_CATEGORY = 3;
  var SCREENING = ['Confirmed Reg', 'Screening Pending', 'Need Practice', 'Selected for Program'];
  var PRESENT = 'Present', ABSENT = 'Not Present';
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
  /** Which genders can enter a program. */
  function gendersFor(program) {
    var g = [];
    if (SPORTS.indexOf(program) >= 0 || ARTS_BOYS.indexOf(program) >= 0) g.push('Boys');
    if (ARTS_GIRLS.indexOf(program) >= 0) g.push('Girls');
    return g;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var SCHEMA = {
    Registrations: [['ts', 'Timestamp'], ['chest', 'Chest No'], ['name', 'Name'], ['gender', 'Gender'],
      ['cls', 'Class'], ['group', 'Group'], ['phone', 'Parent Phone'], ['sports', 'Sports Items'],
      ['arts', 'Arts Items'], ['checkin', 'Check-In Status'], ['notes', 'Volunteer Notes'],
      ['checkinBy', 'Checked In By'], ['checkinAt', 'Check-In Time']],
    Program_Assignments: [['entry', 'Entry ID'], ['chest', 'Chest No'], ['name', 'Student Name'],
      ['gender', 'Gender'], ['cls', 'Class'], ['group', 'Group'], ['program', 'Program Name'],
      ['category', 'Category'], ['screening', 'Screening Status'], ['checkin', 'Check-In Status'],
      ['screenedBy', 'Screened By']],
    Scores: [['program', 'Program Name'], ['group', 'Group'], ['chest', 'Chest No'], ['name', 'Student Name'],
      ['judge', 'Judge Name'], ['score', 'Score'], ['remarks', 'Remarks'], ['ts', 'Timestamp']],
    Live_Leaderboard: [['program', 'Program Name'], ['category', 'Category'], ['gender', 'Gender'],
      ['group', 'Group'], ['rank', 'Rank'], ['chest', 'Chest No'], ['name', 'Student Name'], ['cls', 'Class'],
      ['avg', 'Average Score'], ['total', 'Total Score'], ['judges', 'Judges'], ['updated', 'Updated']],
    Staff_Logs: [['role', 'Role'], ['name', 'Name'], ['phone', 'Phone'], ['ts', 'Login Time'], ['detail', 'Detail']]
  };

  // ---------- helpers ----------
  function fail(msg) { var e = new Error(msg); e.userFacing = true; throw e; }
  function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 120); }
  function normPhone(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function validPhone(p) { return /^\d{9,15}$/.test(p); }
  function splitItems(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function same(a, b) { return String(a) === String(b); }
  function uniq(arr) { var o = []; (arr || []).forEach(function (x) { x = String(x); if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function pickChest(used, rnd) {
    var hi = 999;
    while (used.size >= (hi - 100) * 0.8) hi = hi * 10 + 9; // widen when nearly full
    for (var tries = 0; tries < 5000; tries++) {
      var n = 101 + Math.floor(rnd() * (hi - 100));
      if (!used.has(String(n))) return n;
    }
    for (var m = 101; ; m++) if (!used.has(String(m))) return m;
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
      var key = a.program + '|' + a.gender + '|' + a.group;
      var b = buckets[key] = buckets[key] || { program: a.program, category: a.category || categoryOf(a.program), gender: a.gender, group: a.group, entries: [] };
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
        x.gender.localeCompare(y.gender) || GROUPS.indexOf(x.group) - GROUPS.indexOf(y.group);
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
    if (name.length < 2) fail('Please enter the student\'s full name.');
    if (GENDERS.indexOf(gender) < 0) fail('Please choose Boys or Girls.');
    if (!validPhone(phone)) fail('Please enter a valid parent phone number (9–15 digits).');
    if (CLASSES.indexOf(cls) < 0) fail('Please choose the class in Madrasa.');
    if (GROUPS.indexOf(group) < 0) fail('Please choose the age group.');
    var sports = uniq(p.sports), arts = uniq(p.arts);
    if (gender === 'Girls' && sports.length) fail('Sports items are open to boys only.');
    var artsList = gender === 'Boys' ? ARTS_BOYS : ARTS_GIRLS;
    sports.forEach(function (s) { if (SPORTS.indexOf(s) < 0) fail('Unknown sports item: ' + s); });
    arts.forEach(function (s) { if (artsList.indexOf(s) < 0) fail('Item not available: ' + s); });
    if (sports.length > MAX_PER_CATEGORY) fail('Maximum 3 Sports items.');
    if (arts.length > MAX_PER_CATEGORY) fail('Maximum 3 Arts items.');
    if (!sports.length && !arts.length) fail('Please select at least one item.');

    var regs = db.load('Registrations');
    var dup = regs.filter(function (r) { return same(normPhone(r.phone), phone) && clean(r.name).toLowerCase() === name.toLowerCase(); })[0];
    if (dup) fail(name + ' is already registered with this phone number (Chest No ' + dup.chest + ').');

    var used = {}; regs.forEach(function (r) { used[String(r.chest)] = 1; });
    var chest = pickChest({ has: function (k) { return !!used[k]; }, size: regs.length }, env.random);
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
    } else if (role === 'judge') {
      if (name.length < 2) fail('Please enter your name.');
      if (allPrograms().indexOf(p.program) < 0) fail('Please choose the program you are judging.');
      if (sec.judgeCode && String(p.code || '').trim() !== sec.judgeCode) bad('Incorrect judge code.');
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
      out.assignments = assigns.filter(function (a) { return a.program === s.program; })
        .map(function (a) { return { entry: a.entry, chest: a.chest, gender: a.gender, cls: a.cls, group: a.group, program: a.program, category: a.category, screening: a.screening, checkin: a.checkin }; });
      out.scores = db.load('Scores').filter(function (x) { return x.judge === s.name && x.program === s.program; });
      return out;
    }
    out.assignments = assigns;
    out.registrations = db.load('Registrations');
    if (s.role === 'admin') {
      out.scores = db.load('Scores');
      out.staffLogs = db.load('Staff_Logs');
      out.sheetUrl = env.sheetUrl ? env.sheetUrl() : '';
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

  function checkin(db, env, s, p) {
    var status = p.status === PRESENT ? PRESENT : ABSENT;
    var regs = db.load('Registrations'), reg = null;
    regs.forEach(function (r) {
      if (same(r.chest, p.chest)) { reg = r; r.checkin = status; r.checkinBy = s.name; r.checkinAt = status === PRESENT ? env.now() : ''; }
    });
    if (!reg) fail('Chest number not found.');
    db.save('Registrations', regs);
    var rows = db.load('Program_Assignments');
    rows.forEach(function (r) { if (same(r.chest, p.chest)) r.checkin = status; });
    db.save('Program_Assignments', rows);
    return { ok: true, status: status };
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
    var program = s.role === 'judge' ? s.program : p.program;
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
    if (patch.name != null) { var n = clean(patch.name, 80); if (n.length < 2) fail('Name is too short.'); reg.name = n; }
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
    rebuildLeaderboard(db, env);
    return { ok: true };
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

  function scoreboard(db) {
    var res = computeResults(db.load('Program_Assignments'), db.load('Scores'));
    // Public view: podium only (top 3), no phone numbers.
    res.forEach(function (b) { b.entries = b.entries.filter(function (e) { return e.rank <= 3; }); });
    return { ok: true, results: res };
  }

  var WRITES = { register: 1, login: 1, screen: 1, checkin: 1, note: 1, score: 1, updateReg: 1, deleteReg: 1, deleteScore: 1 };
  var ROLES = {
    data: ['admin', 'teacher', 'volunteer', 'judge'],
    screen: ['admin', 'teacher'],
    checkin: ['admin', 'volunteer'],
    note: ['admin', 'volunteer'],
    score: ['admin', 'judge'],
    updateReg: ['admin'], deleteReg: ['admin'], deleteScore: ['admin']
  };
  var FNS = { data: data, screen: screen, checkin: checkin, note: note, score: score, updateReg: updateReg, deleteReg: deleteReg, deleteScore: deleteScore };

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
    MAX_PER_CATEGORY: MAX_PER_CATEGORY, SCREENING: SCREENING, PRESENT: PRESENT, ABSENT: ABSENT, POINTS: POINTS,
    SCHEMA: SCHEMA, programCode: programCode, categoryOf: categoryOf, allPrograms: allPrograms, splitItems: splitItems,
    computeResults: computeResults, classBoard: classBoard, starBoard: starBoard, handle: handle
  };
})();
