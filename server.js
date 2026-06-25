require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'worldcup-mini-game-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 giờ
}));

/* ---------- Tính tuần (11h trưa Thứ 6 -> 11h trưa Thứ 6 tuần sau, giờ VN) ---------- */
function isoWeek(kickoffTime) {
  const d = new Date(kickoffTime);
  const shifted = new Date(d.getTime() + 7 * 3600 * 1000 - 11 * 3600 * 1000);
  const day = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const back = (day.getUTCDay() - 5 + 7) % 7;
  const friday = new Date(day.getTime() - back * 864e5);
  const y = friday.getUTCFullYear();
  const m = String(friday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(friday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ---------- Trận đã khóa bình chọn chưa ---------- */
function isLocked(match) {
  return Date.now() >= new Date(match.kickoff_time).getTime();
}

/* ---------- Đã đủ thời gian để nhập kết quả chưa? ---------- */
const RESULT_DELAY_MS = 1 * 3600 * 1000;
function canEnterResult(match) {
  return Date.now() >= new Date(match.kickoff_time).getTime() + RESULT_DELAY_MS;
}

/* ---------- Chấm điểm 1 dự đoán ---------- */
function scorePrediction(pred, match) {
  if (match.status !== 'finished' || !match.actual_result) return 0;
  if (pred.predicted_score && match.actual_score &&
      pred.predicted_score.trim() === match.actual_score.trim()) {
    return 3;
  }
  if (pred.predicted_result === match.actual_result) return 1;
  return 0;
}

/* ---------- Tính bảng xếp hạng ---------- */
async function computeLeaderboard(type, weekFilter) {
  const [{ data: players }, { data: matches }, { data: predictions }] = await Promise.all([
    supabase.from('players').select('*').eq('role', 'player'),
    supabase.from('matches').select('*'),
    supabase.from('predictions').select('*')
  ]);

  const matchById = Object.fromEntries((matches || []).map(m => [m.match_id, m]));
  const scores = {};
  for (const p of (players || [])) scores[p.id] = { points: 0, exact: 0, correct: 0 };

  for (const pred of (predictions || [])) {
    const m = matchById[pred.match_id];
    if (!m || m.status !== 'finished') continue;
    if (type === 'week' && weekFilter && isoWeek(m.kickoff_time) !== weekFilter) continue;
    if (!scores[pred.player_id]) continue;
    const pts = scorePrediction(pred, m);
    scores[pred.player_id].points += pts;
    if (pts === 3) scores[pred.player_id].exact += 1;
    else if (pts === 1) scores[pred.player_id].correct += 1;
  }

  const board = (players || []).map(p => ({
    name: p.name,
    points: scores[p.id].points,
    exact: scores[p.id].exact,
    correct: scores[p.id].correct
  }));
  board.sort((a, b) => b.points - a.points || b.exact - a.exact);
  let rank = 0, prev = null;
  board.forEach((row, i) => {
    if (prev === null || row.points !== prev) { rank = i + 1; prev = row.points; }
    row.rank = rank;
  });
  return board;
}

const TOURNAMENT_WEEKS = [
  '2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26',
  '2026-07-03', '2026-07-10', '2026-07-17'
];

async function availableWeeks() {
  const { data: matches } = await supabase.from('matches').select('kickoff_time');
  const fromData = (matches || []).map(m => isoWeek(m.kickoff_time));
  return [...new Set([...TOURNAMENT_WEEKS, ...fromData])].sort();
}

/* ---------- Middleware ---------- */
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Chỉ admin được thao tác' });
  next();
}

/* ---------- Chuẩn hóa giờ về GMT+7 ---------- */
function normalizeVN(timeStr) {
  if (!timeStr) return timeStr;
  const s = String(timeStr).trim();
  const hasTZ = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (hasTZ) return s;
  let core = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(core)) core += ':00';
  return core + '+07:00';
}

const VALID_RESULTS = ['team1', 'draw', 'team2'];
function validateMatch(m, idx) {
  const errs = [];
  if (!m.match_id || typeof m.match_id !== 'string') errs.push(`Trận #${idx}: thiếu match_id`);
  if (!m.team1) errs.push(`Trận #${idx} (${m.match_id}): thiếu team1`);
  if (!m.team2) errs.push(`Trận #${idx} (${m.match_id}): thiếu team2`);
  if (!m.kickoff_time || isNaN(Date.parse(m.kickoff_time)))
    errs.push(`Trận #${idx} (${m.match_id}): kickoff_time không hợp lệ`);
  if (m.status && !['upcoming', 'finished'].includes(m.status))
    errs.push(`Trận #${idx} (${m.match_id}): status phải là upcoming/finished`);
  if (m.actual_result && !VALID_RESULTS.includes(m.actual_result))
    errs.push(`Trận #${idx} (${m.match_id}): actual_result phải là team1/draw/team2`);
  if (m.actual_score && !/^\d{1,2}-\d{1,2}$/.test(m.actual_score.trim()))
    errs.push(`Trận #${idx} (${m.match_id}): actual_score sai định dạng (vd 2-1)`);
  return errs;
}

/* ==================== API ==================== */

app.post('/api/login', async (req, res) => {
  const { id } = req.body;
  const { data: users, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', String(id || '').trim())
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const user = users && users[0];
  if (!user) return res.status(401).json({ error: 'ID không tồn tại' });
  req.session.user = { id: user.id, name: user.name, role: user.role };
  res.json({ name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const { name, role } = req.session.user;
  res.json({ name, role });
});

app.get('/api/matches', requireLogin, async (req, res) => {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('*')
    .order('kickoff_time', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const result = matches.map(m => ({
    ...m,
    week: isoWeek(m.kickoff_time),
    locked: isLocked(m),
    can_enter_result: canEnterResult(m)
  }));
  res.json({ server_now: new Date().toISOString(), matches: result });
});

app.get('/api/predictions/me', requireLogin, async (req, res) => {
  const { data: preds, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('player_id', req.session.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(preds);
});

app.post('/api/predictions', requireLogin, async (req, res) => {
  if (req.session.user.role !== 'player')
    return res.status(403).json({ error: 'Admin không tham gia dự đoán' });

  const { match_id, predicted_result, predicted_score } = req.body;

  const { data: matchRows } = await supabase
    .from('matches').select('*').eq('match_id', match_id).limit(1);
  const match = matchRows && matchRows[0];
  if (!match) return res.status(404).json({ error: 'Không tìm thấy trận' });
  if (isLocked(match))
    return res.status(400).json({ error: 'Trận đã bắt đầu, không thể bình chọn hoặc sửa dự đoán' });
  if (!VALID_RESULTS.includes(predicted_result))
    return res.status(400).json({ error: 'Cửa dự đoán không hợp lệ' });
  const score = (predicted_score || '').trim();
  if (score && !/^\d{1,2}-\d{1,2}$/.test(score))
    return res.status(400).json({ error: 'Tỷ số sai định dạng (vd 2-1)' });

  const entry = {
    player_id: req.session.user.id,
    match_id,
    predicted_result,
    predicted_score: score || null,
    submitted_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from('predictions')
    .upsert(entry, { onConflict: 'player_id,match_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/leaderboard', requireLogin, async (req, res) => {
  const type = req.query.type === 'week' ? 'week' : 'season';
  const week = req.query.week || null;
  const [board, weeks] = await Promise.all([
    computeLeaderboard(type, week),
    availableWeeks()
  ]);
  res.json({ type, week, weeks, board });
});

/* ---------- Admin ---------- */

app.post('/api/admin/result', requireAdmin, async (req, res) => {
  const { match_id, actual_result, actual_score } = req.body;
  const clear = !actual_result;
  if (actual_result && !VALID_RESULTS.includes(actual_result))
    return res.status(400).json({ error: 'Kết quả không hợp lệ' });
  const score = (actual_score || '').trim();
  if (score && !/^\d{1,2}-\d{1,2}$/.test(score))
    return res.status(400).json({ error: 'Tỷ số sai định dạng (vd 2-1)' });

  const { data: matchRows } = await supabase
    .from('matches').select('*').eq('match_id', match_id).limit(1);
  const m = matchRows && matchRows[0];
  if (!m) return res.status(404).json({ error: 'Không tìm thấy trận' });

  if (!clear && !canEnterResult(m))
    return res.status(400).json({ error: 'Chỉ được nhập kết quả sau khi trận bắt đầu ít nhất 3 giờ (đảm bảo trận đã kết thúc)' });

  const { error } = await supabase
    .from('matches')
    .update({
      actual_result: actual_result || null,
      actual_score: score || null,
      status: clear ? 'upcoming' : 'finished'
    })
    .eq('match_id', match_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/api/admin/match', requireAdmin, async (req, res) => {
  const m = req.body;
  const errs = validateMatch(m, 0);
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  const entry = {
    match_id: m.match_id,
    round: m.round || '',
    team1: m.team1,
    team2: m.team2,
    kickoff_time: normalizeVN(m.kickoff_time),
    status: m.status || 'upcoming',
    actual_result: m.actual_result || null,
    actual_score: m.actual_score || null
  };
  const { error } = await supabase
    .from('matches')
    .upsert(entry, { onConflict: 'match_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/api/admin/import', requireAdmin, upload.single('file'), async (req, res) => {
  let payload;
  try {
    const raw = req.file ? req.file.buffer.toString('utf8') : req.body.data;
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(400).json({ error: 'File JSON không parse được: ' + e.message });
  }
  if (!Array.isArray(payload))
    return res.status(400).json({ error: 'JSON phải là mảng các trận đấu' });

  const errs = [];
  payload.forEach((m, i) => errs.push(...validateMatch(m, i + 1)));
  if (errs.length) return res.status(400).json({ error: 'Lỗi schema', details: errs });

  const { data: existing } = await supabase.from('matches').select('match_id');
  const existingIds = new Set((existing || []).map(m => m.match_id));
  let added = 0, updated = 0;
  payload.forEach(m => { existingIds.has(m.match_id) ? updated++ : added++; });

  if (!req.body.commit || req.body.commit === 'false') {
    return res.json({ preview: true, added, updated, total: payload.length });
  }

  const rows = payload.map(m => ({
    match_id: m.match_id,
    round: m.round || '',
    team1: m.team1,
    team2: m.team2,
    kickoff_time: normalizeVN(m.kickoff_time),
    status: m.status || (m.actual_result ? 'finished' : 'upcoming'),
    actual_result: m.actual_result || null,
    actual_score: m.actual_score || null
  }));

  const { error } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'match_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, added, updated });
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const [{ data: players }, { data: matches }, { data: predictions }] = await Promise.all([
    supabase.from('players').select('*'),
    supabase.from('matches').select('*'),
    supabase.from('predictions').select('*')
  ]);
  const bundle = {
    exported_at: new Date().toISOString(),
    players,
    matches,
    predictions
  };
  res.setHeader('Content-Disposition', `attachment; filename="worldcup-backup-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(bundle, null, 2));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, () => console.log(`World Cup game chạy tại http://localhost:${PORT}`));
