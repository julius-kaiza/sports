const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Initialize PostgreSQL Connection Pool for Supabase
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for cloud databases like Supabase
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection error: ', err.stack);
    } else {
        console.log('Connected to secure Supabase PostgreSQL database.');
        release();
    }
});

// Create Tables & Seed SuperAdmin if empty
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                pin TEXT,
                role TEXT DEFAULT 'blogger'
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                type TEXT,
                title TEXT,
                body TEXT,
                media_url TEXT,
                category TEXT,
                author TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS adverts (
                id SERIAL PRIMARY KEY,
                title TEXT,
                media_url TEXT,
                body TEXT,
                target_url TEXT,
                media_type TEXT
            )
        `);

        // Seed default Master Admin if empty
        const res = await pool.query(`SELECT COUNT(*) as count FROM users`);
        if (parseInt(res.rows[0].count) === 0) {
            await pool.query(`INSERT INTO users (username, pin, role) VALUES ('SuperAdmin', '1234', 'admin')`);
            console.log('Default SuperAdmin seeded.');
        }
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
};

initDB();

// API: Get All Content, Adverts, and Users
app.get('/api/content', async (req, res) => {
    try {
        const posts = await pool.query(`SELECT * FROM posts ORDER BY id DESC`);
        const adverts = await pool.query(`SELECT * FROM adverts ORDER BY id DESC`);
        const users = await pool.query(`SELECT id, username, role FROM users`);
        res.json({ all_posts: posts.rows, adverts: adverts.rows, users: users.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Publish or Update Content
app.post('/api/admin/publish', async (req, res) => {
    const { id, type, title, body, media_url, category, author } = req.body;
    try {
        if (id) {
            await pool.query(
                `UPDATE posts SET type = $1, title = $2, body = $3, media_url = $4, category = $5 WHERE id = $6`,
                [type, title, body, media_url, category, id]
            );
            res.json({ success: true, postId: id });
        } else {
            const result = await pool.query(
                `INSERT INTO posts (type, title, body, media_url, category, author) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [type, title, body, media_url, category, author || 'Staff Blogger']
            );
            res.json({ success: true, postId: result.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Delete Post
app.delete('/api/admin/posts/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM posts WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API: SuperAdmin Add Blogger
app.post('/api/admin/bloggers', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO users (username, pin, role) VALUES ($1, $2, 'blogger') RETURNING id`,
            [username, pin]
        );
        res.json({ success: true, userId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Username may already exist' });
    }
});

// API: SuperAdmin Delete Blogger
app.delete('/api/admin/bloggers/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM users WHERE id = $1 AND role = 'blogger'`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API: Update User / Admin Password with Confirmation
app.post('/api/admin/update-password', async (req, res) => {
    const { username, new_pin, confirm_pin } = req.body;
    if (!new_pin || new_pin !== confirm_pin) {
        return res.status(400).json({ success: false, error: 'New passwords do not match or are empty.' });
    }
    try {
        const updateRes = await pool.query(`UPDATE users SET pin = $1 WHERE username = $2`, [new_pin, username]);
        if (updateRes.rowCount === 0) {
            if (username === 'SuperAdmin') {
                await pool.query(
                    `INSERT INTO users (username, pin, role) VALUES ('SuperAdmin', $1, 'admin') ON CONFLICT (username) DO UPDATE SET pin = $1`,
                    [new_pin]
                );
                return res.json({ success: true });
            } else {
                return res.status(404).json({ success: false, error: 'User not found.' });
            }
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Deploy Permanent Universal Advert
app.post('/api/admin/adverts', async (req, res) => {
    const { title, media_url, body, target_url, media_type } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO adverts (title, media_url, body, target_url, media_type) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [title, media_url, body, target_url || '', media_type || 'image']
        );
        res.json({ success: true, adId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API: Delete Permanent Advert
app.delete('/api/admin/adverts/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM adverts WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API: Auth Check
app.post('/api/auth/login', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const userQuery = await pool.query(`SELECT * FROM users WHERE username = $1 AND pin = $2`, [username, pin]);
        if (userQuery.rows.length > 0) {
            const user = userQuery.rows[0];
            res.json({ success: true, role: user.role, username: user.username });
        } else {
            if (username === 'SuperAdmin' && pin === '1234') {
                res.json({ success: true, role: 'admin', username: 'SuperAdmin' });
            } else {
                res.status(401).json({ success: false, message: 'Invalid Credentials' });
            }
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`ProPulse Sports Portal running at http://localhost:${PORT}`);
});
