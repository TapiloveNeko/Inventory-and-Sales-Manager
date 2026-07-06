require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('DB接続プールでエラーが発生しました（プロセスは継続します）:', err);
});

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 画像のbase64を許容するため大きめに設定
app.use(express.static(__dirname));

// ─── DB 初期化 ────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_rows (
      id         TEXT        PRIMARY KEY,
      row_order  INTEGER     NOT NULL,
      data       JSONB       NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('データベース初期化完了');
}

// ─── GET /api/rows ────────────────────────────────────────
// 全行を row_order 順で返す
app.get('/api/rows', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data FROM inventory_rows ORDER BY row_order ASC'
    );
    res.json(result.rows.map((r) => r.data));
  } catch (err) {
    console.error('GET /api/rows エラー:', err);
    res.status(500).json({ error: 'データの取得に失敗しました' });
  }
});

// ─── PUT /api/rows ────────────────────────────────────────
// 全行を一括置換（削除してから挿入）
app.put('/api/rows', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows は配列である必要があります' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM inventory_rows');

    for (let i = 0; i < rows.length; i++) {
      await client.query(
        'INSERT INTO inventory_rows (id, row_order, data) VALUES ($1, $2, $3)',
        [rows[i].id, i, JSON.stringify(rows[i])]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/rows エラー:', err);
    res.status(500).json({ error: 'データの保存に失敗しました' });
  } finally {
    client.release();
  }
});

// ─── 起動 ─────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`サーバー起動: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('データベース初期化エラー:', err);
    process.exit(1);
  });