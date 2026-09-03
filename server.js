const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");

const app = express();

/* ============================================================
   CONFIGURATION
============================================================ */

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

const DATABASE_URL = process.env.DATABASE_URL;
let JWT_SECRET = process.env.JWT_SECRET;

console.log("DEBUG - DATABASE_URL exists:", !!DATABASE_URL);
console.log("DEBUG - JWT_SECRET exists:", !!JWT_SECRET);

if (!JWT_SECRET) {
    console.warn("WARNING: JWT_SECRET is missing from environment. Using a temporary fallback for testing.");
    JWT_SECRET = "fallback_secret_key_propulse_12345";
}

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "SuperAdmin").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not configured.");
    process.exit(1);
}

if (!ADMIN_PASSWORD) {
    console.error("ERROR: ADMIN_PASSWORD is not configured.");
    process.exit(1);
}

/* ============================================================
   EXPRESS CONFIGURATION
============================================================ */

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "1mb"
    })
);

/* ============================================================
   CORS
============================================================ */

const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin) {
                return callback(null, true);
            }
            if (allowedOrigins.length === 0) {
                return callback(null, true);
            }
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error("Origin not allowed by CORS"));
        },
        credentials: true
    })
);

/* ============================================================
   DATABASE
============================================================ */

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: false
});

pool.on("error", error => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
});

/* ============================================================
   DATABASE INITIALIZATION
============================================================ */

async function initDB() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // USERS
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                pin TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'blogger',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // POSTS
        await client.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'uganda',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                media_url TEXT DEFAULT '',
                category TEXT DEFAULT '',
                author TEXT NOT NULL DEFAULT 'SuperAdmin',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // ADVERTS
        await client.query(`
            CREATE TABLE IF NOT EXISTS adverts (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                media_url TEXT DEFAULT '',
                body TEXT DEFAULT '',
                target_url TEXT DEFAULT '',
                media_type TEXT DEFAULT 'image',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // SITE SETTINGS
        await client.query(`
            CREATE TABLE IF NOT EXISTS site_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT NOT NULL UNIQUE,
                setting_value TEXT DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // INDEXES
        await client.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_adverts_created_at ON adverts(created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

        // DEFAULT SETTINGS
        await client.query(`
            INSERT INTO site_settings (setting_key, setting_value)
            VALUES 
                ('whatsapp_phone', '256700000000'),
                ('whatsapp_message', 'Hello ProPulse Sports, I am reaching out from your live portal!')
            ON CONFLICT (setting_key) DO NOTHING
        `);

        // TRIGGER FUNCTION
        await client.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$;
        `);

        await client.query(`DROP TRIGGER IF EXISTS posts_updated_at_trigger ON posts`);
        await client.query(`
            CREATE TRIGGER posts_updated_at_trigger
            BEFORE UPDATE ON posts
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        `);

        await client.query(`DROP TRIGGER IF EXISTS site_settings_updated_at_trigger ON site_settings`);
        await client.query(`
            CREATE TRIGGER site_settings_updated_at_trigger
            BEFORE UPDATE ON site_settings
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        `);

        // SUPER ADMIN SETUP
        const existingAdmin = await client.query(
            `SELECT id, username, pin, role FROM users WHERE username = $1 LIMIT 1`,
            [ADMIN_USERNAME]
        );

        if (existingAdmin.rows.length === 0) {
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
            await client.query(
                `INSERT INTO users (username, pin, role) VALUES ($1, $2, 'admin')`,
                [ADMIN_USERNAME, passwordHash]
            );
            console.log(`Created administrator account: ${ADMIN_USERNAME}`);
        } else {
            const admin = existingAdmin.rows[0];
            const alreadyHashed = typeof admin.pin === "string" && admin.pin.startsWith("$2");

            if (!alreadyHashed) {
                const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
                await client.query(
                    `UPDATE users SET pin = $1, role = 'admin' WHERE id = $2`,
                    [passwordHash, admin.id]
                );
                console.log("Existing administrator password upgraded securely.");
            } else {
                await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
            }
        }

        await client.query("COMMIT");
        console.log("Database initialized successfully.");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Database initialization failed:", error.message);
        throw error;
    } finally {
        client.release();
    }
}

/* ============================================================
   AUTHENTICATION HELPERS
============================================================ */

function createAuthToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        { expiresIn: "8h" }
    );
}

function getTokenFromRequest(req) {
    const cookies = req.headers.cookie || "";
    const authCookie = cookies
        .split(";")
        .map(item => item.trim())
        .find(item => item.startsWith("propulse_auth="));

    if (!authCookie) return null;

    const rawToken = authCookie.split("=").slice(1).join("=");
    try {
        return decodeURIComponent(rawToken);
    } catch {
        return rawToken;
    }
}

function authenticate(req, res, next) {
    try {
        const token = getTokenFromRequest(req);
        if (!token) {
            return res.status(401).json({ success: false, error: "Authentication required." });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        return next();
    } catch {
        return res.status(401).json({ success: false, error: "Your session has expired. Please sign in again." });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ success: false, error: "Administrator privileges required." });
    }
    return next();
}

/* ============================================================
   INPUT HELPERS
============================================================ */

function clean(value, maxLength = 10000) {
    if (value === undefined || value === null) return "";
    return String(value).trim().slice(0, maxLength);
}

function validId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

/* ============================================================
   ROUTES
============================================================ */

app.get("/", (req, res, next) => {
    res.sendFile(path.join(__dirname, "index.html"), error => {
        if (error) next(error);
    });
});

app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() AS database_time");
        return res.status(200).json({
            success: true,
            database: "connected",
            service: "ProPulse Sports Portal",
            timestamp: new Date().toISOString(),
            database_time: result.rows[0].database_time
        });
    } catch (error) {
        return res.status(503).json({
            success: false,
            database: "unavailable",
            error: NODE_ENV === "production" ? "Database unavailable." : error.message
        });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const username = clean(req.body.username, 100);
        const pin = String(req.body.pin || "");

        if (!username || !pin) {
            return res.status(400).json({ success: false, error: "Username and password are required." });
        }

        const result = await pool.query(
            `SELECT id, username, pin, role FROM users WHERE username = $1 LIMIT 1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: "Invalid username or password." });
        }

        const user = result.rows[0];
        let passwordMatches = false;

        if (user.pin && user.pin.startsWith("$2")) {
            passwordMatches = await bcrypt.compare(pin, user.pin);
        } else {
            passwordMatches = pin === user.pin;
            if (passwordMatches) {
                const upgradedHash = await bcrypt.hash(pin, 12);
                await pool.query(`UPDATE users SET pin = $1 WHERE id = $2`, [upgradedHash, user.id]);
            }
        }

        if (!passwordMatches) {
            return res.status(401).json({ success: false, error: "Invalid username or password." });
        }

        const token = createAuthToken(user);
        res.cookie("propulse_auth", token, {
            httpOnly: true,
            secure: NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 8 * 60 * 60 * 1000,
            path: "/"
        });

        return res.json({ success: true, username: user.username, role: user.role });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Unable to authenticate." });
    }
});

app.get("/api/auth/me", authenticate, (req, res) => {
    return res.json({ success: true, username: req.user.username, role: req.user.role });
});

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("propulse_auth", {
        httpOnly: true,
        secure: NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
    });
    return res.json({ success: true });
});

app.get("/api/content", async (req, res) => {
    try {
        const [posts, adverts, users, settings] = await Promise.all([
            pool.query(`SELECT id, type, title, body, media_url, category, author, created_at, updated_at FROM posts ORDER BY created_at DESC, id DESC`),
            pool.query(`SELECT id, title, media_url, body, target_url, media_type, created_at FROM adverts ORDER BY created_at DESC, id DESC`),
            pool.query(`SELECT id, username, role, created_at FROM users ORDER BY username ASC`),
            pool.query(`SELECT setting_key, setting_value FROM site_settings`)
        ]);

        const settingMap = {};
        settings.rows.forEach(setting => {
            settingMap[setting.setting_key] = setting.setting_value;
        });

        return res.json({
            success: true,
            all_posts: posts.rows,
            adverts: adverts.rows,
            users: users.rows,
            settings: {
                whatsapp_phone: settingMap.whatsapp_phone || "256700000000",
                whatsapp_message: settingMap.whatsapp_message || "Hello ProPulse Sports, I am reaching out from your live portal!"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Unable to load portal data." });
    }
});

app.post("/api/admin/publish", authenticate, async (req, res) => {
    try {
        const id = validId(req.body.id);
        const type = clean(req.body.type, 50);
        const title = clean(req.body.title, 300);
        const body = clean(req.body.body, 30000);
        const media_url = clean(req.body.media_url, 2000);
        const category = clean(req.body.category || type, 100);

        if (!type || !title || !body) {
            return res.status(400).json({ success: false, error: "Category, title and story body are required." });
        }

        if (id) {
            const existing = await pool.query(`SELECT id, author FROM posts WHERE id = $1`, [id]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Story not found." });
            }

            if (req.user.role !== "admin" && existing.rows[0].author !== req.user.username) {
                return res.status(403).json({ success: false, error: "Unauthorized to edit this story." });
            }

            await pool.query(
                `UPDATE posts SET type = $1, title = $2, body = $3, media_url = $4, category = $5 WHERE id = $6`,
                [type, title, body, media_url, category, id]
            );

            return res.json({ success: true, message: "Story updated successfully." });
        } else {
            await pool.query(
                `INSERT INTO posts (type, title, body, media_url, category, author) VALUES ($1, $2, $3, $4, $5, $6)`,
                [type, title, body, media_url, category, req.user.username]
            );

            return res.json({ success: true, message: "Story published successfully." });
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: "Failed to save story." });
    }
});

app.post("/api/admin/settings/whatsapp", authenticate, requireAdmin, async (req, res) => {
    try {
        const phone = clean(req.body.whatsapp_phone, 50);
        const message = clean(req.body.whatsapp_message, 1000);

        if (!phone) {
            return res.status(400).json({ success: false, error: "WhatsApp phone number is required." });
        }

        // Update or insert whatsapp_phone
        await pool.query(
            `INSERT INTO site_settings (setting_key, setting_value) VALUES ('whatsapp_phone', $1)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
            [phone]
        );

        // Update or insert whatsapp_message
        await pool.query(
            `INSERT INTO site_settings (setting_key, setting_value) VALUES ('whatsapp_message', $1)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
            [message]
        );

        return res.json({ success: true, message: "WhatsApp settings updated successfully." });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Failed to update WhatsApp settings." });
    }
});

app.post("/api/admin/adverts", authenticate, requireAdmin, async (req, res) => {
    try {
        const title = clean(req.body.title, 300);
        const media_url = clean(req.body.media_url, 2000);
        const body = clean(req.body.body, 5000);
        const target_url = clean(req.body.target_url, 2000);
        const media_type = clean(req.body.media_type || "image", 50);

        if (!title) {
            return res.status(400).json({ success: false, error: "Advert title is required." });
        }

        await pool.query(
            `INSERT INTO adverts (title, media_url, body, target_url, media_type) VALUES ($1, $2, $3, $4, $5)`,
            [title, media_url, body, target_url, media_type]
        );

        return res.json({ success: true, message: "Advert published successfully." });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Failed to publish advert." });
    }
});
/* ============================================================
   START SERVER
============================================================ */

initDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT} in ${NODE_ENV} mode.`);
        });
    })
    .catch(error => {
        console.error("Failed to start server due to database initialization failure:", error);
        process.exit(1);
    });
