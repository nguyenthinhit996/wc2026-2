require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function normalizeVN(timeStr) {
  if (!timeStr) return timeStr;
  const s = String(timeStr).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  let core = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(core)) core += ':00';
  return core + '+07:00';
}

async function seed() {
  const players     = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/players.json'), 'utf8'));
  const matches     = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/matches.json'), 'utf8'));
  const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/predictions.json'), 'utf8'));

  // ---- Players ----
  process.stdout.write('Đang import players... ');
  const { error: pe } = await supabase
    .from('players')
    .upsert(players, { onConflict: 'id' });
  if (pe) { console.error('\nLỗi players:', pe.message); process.exit(1); }
  console.log(`✓ ${players.length} người chơi`);

  // ---- Matches ----
  process.stdout.write('Đang import matches... ');
  const normalizedMatches = matches.map(m => ({
    ...m,
    kickoff_time: normalizeVN(m.kickoff_time)
  }));
  const { error: me } = await supabase
    .from('matches')
    .upsert(normalizedMatches, { onConflict: 'match_id' });
  if (me) { console.error('\nLỗi matches:', me.message); process.exit(1); }
  console.log(`✓ ${matches.length} trận đấu`);

  // ---- Predictions ----
  process.stdout.write('Đang import predictions... ');
  const validMatchIds = new Set(normalizedMatches.map(m => m.match_id));
  const validPreds = predictions.filter(p => validMatchIds.has(p.match_id));
  const skipped = predictions.length - validPreds.length;
  if (skipped > 0) console.log(`\n  (bỏ qua ${skipped} dự đoán có match_id không tồn tại)`);
  if (validPreds.length > 0) {
    const { error: pre } = await supabase
      .from('predictions')
      .upsert(validPreds, { onConflict: 'player_id,match_id' });
    if (pre) { console.error('\nLỗi predictions:', pre.message); process.exit(1); }
  }
  console.log(`✓ ${validPreds.length} dự đoán`);

  console.log('\nHoàn tất! Toàn bộ dữ liệu đã được đưa lên Supabase.');
}

seed().catch(err => { console.error(err); process.exit(1); });
