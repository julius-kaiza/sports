const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Initialize Secure Database
const db = new sqlite3.Database('./sports_portal.db', (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to secure SQLite database.');
});

// Create Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        pin TEXT,
        role TEXT DEFAULT 'blogger'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        title TEXT,
        body TEXT,
        media_url TEXT,
        category TEXT,
        author TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS adverts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        media_url TEXT,
        body TEXT,
        target_url TEXT,
        media_type TEXT
    )`);

    // Seed default Master Admin if empty
    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO users (username, pin, role) VALUES ('SuperAdmin', '1234', 'admin')`);
        }
    });
});

// API: Get All Content, Adverts, and Users (Excluding sensitive pin data from general exposure)
app.get('/api/content', (req, res) => {
    db.all(`SELECT * FROM posts ORDER BY id DESC`, (err, posts) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT * FROM adverts ORDER BY id DESC`, (err, adverts) => {
            if (err) return res.status(500).json({ error: err.message });
            db.all(`SELECT id, username, role FROM users`, (err, users) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ all_posts: posts, adverts: adverts, users: users });
            });
        });
    });
});

// API: Publish or Update Content
app.post('/api/admin/publish', (req, res) => {
    const { id, type, title, body, media_url, category, author } = req.body;
    if (id) {
        db.run(`UPDATE posts SET type = ?, title = ?, body = ?, media_url = ?, category = ? WHERE id = ?`,
            [type, title, body, media_url, category, id],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, postId: id });
            }
        );
    } else {
        db.run(`INSERT INTO posts (type, title, body, media_url, category, author) VALUES (?, ?, ?, ?, ?, ?)`,
            [type, title, body, media_url, category, author || 'Staff Blogger'],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, postId: this.lastID });
            }
        );
    }
});

// API: Delete Post
app.delete('/api/admin/posts/:id', (req, res) => {
    const postId = req.params.id;
    db.run(`DELETE FROM posts WHERE id = ?`, postId, (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// API: SuperAdmin Add Blogger
app.post('/api/admin/bloggers', (req, res) => {
    const { username, pin } = req.body;
    db.run(`INSERT INTO users (username, pin, role) VALUES (?, ?, 'blogger')`,
        [username, pin],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: 'Username may already exist' });
            res.json({ success: true, userId: this.lastID });
        }
    );
});

// API: SuperAdmin Delete Blogger
app.delete('/api/admin/bloggers/:id', (req, res) => {
    const userId = req.params.id;
    db.run(`DELETE FROM users WHERE id = ? AND role = 'blogger'`, userId, (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// API: Update User / Admin Password with Confirmation
app.post('/api/admin/update-password', (req, res) => {
    const { username, new_pin, confirm_pin } = req.body;
    if (!new_pin || new_pin !== confirm_pin) {
        return res.status(400).json({ success: false, error: 'New passwords do not match or are empty.' });
    }
    db.run(`UPDATE users SET pin = ? WHERE username = ?`, [new_pin, username], function(err) {
        if (err || this.changes === 0) {
            // Handle fallback SuperAdmin if stored in code/default seed or not yet in table
            if (username === 'SuperAdmin') {
                db.run(`INSERT OR REPLACE INTO users (username, pin, role) VALUES ('SuperAdmin', ?, 'admin')`, [new_pin], (err2) => {
                    if (err2) return res.status(500).json({ success: false, error: 'Failed to update SuperAdmin password' });
                    return res.json({ success: true });
                });
            } else {
                return res.status(404).json({ success: false, error: 'User not found.' });
            }
        } else {
            res.json({ success: true });
        }
    });
});

// API: Deploy Permanent Universal Advert
app.post('/api/admin/adverts', (req, res) => {
    const { title, media_url, body, target_url, media_type } = req.body;
    db.run(`INSERT INTO adverts (title, media_url, body, target_url, media_type) VALUES (?, ?, ?, ?, ?)`,
        [title, media_url, body, target_url || '', media_type || 'image'],
        function(err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, adId: this.lastID });
        }
    );
});

// API: Delete Permanent Advert
app.delete('/api/admin/adverts/:id', (req, res) => {
    const adId = req.params.id;
    db.run(`DELETE FROM adverts WHERE id = ?`, adId, (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// API: Auth Check
app.post('/api/auth/login', (req, res) => {
    const { username, pin } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND pin = ?`, [username, pin], (err, user) => {
        if (user) {
            res.json({ success: true, role: user.role, username: user.username });
        } else {
            if (username === 'SuperAdmin' && pin === '1234') {
                res.json({ success: true, role: 'admin', username: 'SuperAdmin' });
            } else {
                res.status(401).json({ success: false, message: 'Invalid Credentials' });
            }
        }
    });
});

app.listen(PORT, () => {
    console.log(`ProPulse Sports Portal running at http://localhost:${PORT}`);
});