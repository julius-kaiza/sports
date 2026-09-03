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
const JWT_SECRET = process.env.JWT_SECRET || "temporary_fallback_key_123";
// Temporary debug and fallback to prevent crash loops
let JWT_SECRET = process.env.JWT_SECRET;

console.log("DEBUG - DATABASE_URL exists:", !!DATABASE_URL);
console.log("DEBUG - JWT_SECRET exists:", !!JWT_SECRET);

if (!JWT_SECRET) {
    console.warn("WARNING: JWT_SECRET is missing from environment. Using a temporary fallback for testing.");
    JWT_SECRET = "fallback_secret_key_propulse_12345";
}

const ADMIN_USERNAME =
    String(process.env.ADMIN_USERNAME || "SuperAdmin").trim();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not configured.");
    process.exit(1);
}

if (!JWT_SECRET) {
    console.error("ERROR: JWT_SECRET is not configured.");
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
            /*
             * Requests without an Origin header include:
             * - server-to-server requests
             * - health checks
             * - some command-line tools
             */
            if (!origin) {
                return callback(null, true);
            }

            /*
             * If FRONTEND_URL is not configured, preserve the
             * existing functionality by allowing the request.
             */
            if (allowedOrigins.length === 0) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(
                new Error("Origin not allowed by CORS")
            );
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
    console.error(
        "Unexpected PostgreSQL pool error:",
        error.message
    );
});

/* ============================================================
   DATABASE INITIALIZATION
============================================================ */

async function initDB() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        /* ====================================================
           USERS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                pin TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'blogger',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS username TEXT
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS pin TEXT
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'blogger'
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
        `);

        await client.query(`
            UPDATE users
            SET role = 'blogger'
            WHERE role IS NULL
        `);

        await client.query(`
            UPDATE users
            SET created_at = NOW()
            WHERE created_at IS NULL
        `);

        /* ====================================================
           POSTS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                media_url TEXT DEFAULT '',
                category TEXT DEFAULT '',
                author TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'uganda'
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS title TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS body TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS author TEXT DEFAULT 'SuperAdmin'
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
        `);

        await client.query(`
            ALTER TABLE posts
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
        `);

        await client.query(`
            UPDATE posts
            SET type = 'uganda'
            WHERE type IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET title = ''
            WHERE title IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET body = ''
            WHERE body IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET media_url = ''
            WHERE media_url IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET category = ''
            WHERE category IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET author = 'SuperAdmin'
            WHERE author IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET created_at = NOW()
            WHERE created_at IS NULL
        `);

        await client.query(`
            UPDATE posts
            SET updated_at = NOW()
            WHERE updated_at IS NULL
        `);

        /* ====================================================
           ADVERTS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS adverts (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                media_url TEXT DEFAULT '',
                body TEXT DEFAULT '',
                target_url TEXT DEFAULT '',
                media_type TEXT DEFAULT 'image',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS title TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS body TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS target_url TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'image'
        `);

        await client.query(`
            ALTER TABLE adverts
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
        `);

        await client.query(`
            UPDATE adverts
            SET title = ''
            WHERE title IS NULL
        `);

        await client.query(`
            UPDATE adverts
            SET media_url = ''
            WHERE media_url IS NULL
        `);

        await client.query(`
            UPDATE adverts
            SET body = ''
            WHERE body IS NULL
        `);

        await client.query(`
            UPDATE adverts
            SET target_url = ''
            WHERE target_url IS NULL
        `);

        await client.query(`
            UPDATE adverts
            SET media_type = 'image'
            WHERE media_type IS NULL
        `);

        await client.query(`
            UPDATE adverts
            SET created_at = NOW()
            WHERE created_at IS NULL
        `);

        /* ====================================================
           SITE SETTINGS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS site_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT NOT NULL UNIQUE,
                setting_value TEXT DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await client.query(`
            ALTER TABLE site_settings
            ADD COLUMN IF NOT EXISTS setting_key TEXT
        `);

        await client.query(`
            ALTER TABLE site_settings
            ADD COLUMN IF NOT EXISTS setting_value TEXT DEFAULT ''
        `);

        await client.query(`
            ALTER TABLE site_settings
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
        `);

        await client.query(`
            UPDATE site_settings
            SET setting_value = ''
            WHERE setting_value IS NULL
        `);

        await client.query(`
            UPDATE site_settings
            SET updated_at = NOW()
            WHERE updated_at IS NULL
        `);

        /* ====================================================
           INDEXES
        ==================================================== */

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_posts_created_at
            ON posts(created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_posts_type
            ON posts(type)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_posts_author
            ON posts(author)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_adverts_created_at
            ON adverts(created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_username
            ON users(username)
        `);

        /* ====================================================
           DEFAULT WHATSAPP SETTINGS
        ==================================================== */

        await client.query(`
            INSERT INTO site_settings
                (
                    setting_key,
                    setting_value
                )
            VALUES
                (
                    'whatsapp_phone',
                    '256700000000'
                ),
                (
                    'whatsapp_message',
                    'Hello ProPulse Sports, I am reaching out from your live portal!'
                )
            ON CONFLICT (setting_key)
            DO NOTHING
        `);

        /* ====================================================
           UPDATED_AT FUNCTION
        ==================================================== */

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

        /* ====================================================
           POSTS TRIGGER
        ==================================================== */

        await client.query(`
            DROP TRIGGER IF EXISTS posts_updated_at_trigger
            ON posts
        `);

        await client.query(`
            CREATE TRIGGER posts_updated_at_trigger
            BEFORE UPDATE ON posts
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        `);

        /* ====================================================
           SETTINGS TRIGGER
        ==================================================== */

        await client.query(`
            DROP TRIGGER IF EXISTS site_settings_updated_at_trigger
            ON site_settings
        `);

        await client.query(`
            CREATE TRIGGER site_settings_updated_at_trigger
            BEFORE UPDATE ON site_settings
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        `);

        /* ====================================================
           SUPER ADMIN
        ==================================================== */

        const existingAdmin = await client.query(
            `
                SELECT
                    id,
                    username,
                    pin,
                    role
                FROM users
                WHERE username = $1
                LIMIT 1
            `,
            [ADMIN_USERNAME]
        );

        if (existingAdmin.rows.length === 0) {
            const passwordHash =
                await bcrypt.hash(
                    ADMIN_PASSWORD,
                    12
                );

            await client.query(
                `
                    INSERT INTO users
                        (
                            username,
                            pin,
                            role
                        )
                    VALUES
                        (
                            $1,
                            $2,
                            'admin'
                        )
                `,
                [
                    ADMIN_USERNAME,
                    passwordHash
                ]
            );

            console.log(
                `Created administrator account: ${ADMIN_USERNAME}`
            );
        } else {
            const admin =
                existingAdmin.rows[0];

            const alreadyHashed =
                typeof admin.pin === "string" &&
                admin.pin.startsWith("$2");

            if (!alreadyHashed) {
                const passwordHash =
                    await bcrypt.hash(
                        ADMIN_PASSWORD,
                        12
                    );

                await client.query(
                    `
                        UPDATE users
                        SET
                            pin = $1,
                            role = 'admin'
                        WHERE id = $2
                    `,
                    [
                        passwordHash,
                        admin.id
                    ]
                );

                console.log(
                    "Existing administrator password upgraded securely."
                );
            } else {
                await client.query(
                    `
                        UPDATE users
                        SET role = 'admin'
                        WHERE id = $1
                    `,
                    [admin.id]
                );
            }
        }

        await client.query("COMMIT");

        console.log(
            "Database initialized successfully."
        );

        return true;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(
                "Database rollback failed:",
                rollbackError.message
            );
        }

        console.error(
            "Database initialization failed:",
            error.message
        );

        throw error;
    } finally {
        client.release();
    }
}

/* ============================================================
   AUTHENTICATION
============================================================ */

function createAuthToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        {
            expiresIn: "8h"
        }
    );
}

function getTokenFromRequest(req) {
    const cookies =
        req.headers.cookie || "";

    const authCookie =
        cookies
            .split(";")
            .map(item => item.trim())
            .find(
                item =>
                    item.startsWith(
                        "propulse_auth="
                    )
            );

    if (!authCookie) {
        return null;
    }

    const rawToken =
        authCookie
            .split("=")
            .slice(1)
            .join("=");

    try {
        return decodeURIComponent(
            rawToken
        );
    } catch {
        return rawToken;
    }
}

function authenticate(req, res, next) {
    try {
        const token =
            getTokenFromRequest(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                error:
                    "Authentication required."
            });
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        req.user = decoded;

        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error:
                "Your session has expired. Please sign in again."
        });
    }
}

function requireAdmin(req, res, next) {
    if (
        !req.user ||
        req.user.role !== "admin"
    ) {
        return res.status(403).json({
            success: false,
            error:
                "Administrator privileges required."
        });
    }

    return next();
}

/* ============================================================
   INPUT HELPERS
============================================================ */

function clean(value, maxLength = 10000) {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, maxLength);
}

function validId(value) {
    const id =
        Number(value);

    if (
        !Number.isInteger(id) ||
        id <= 0
    ) {
        return null;
    }

    return id;
}

/* ============================================================
   BASIC STATUS
============================================================ */

app.get(
    "/",
    (req, res, next) => {
        const indexPath =
            path.join(
                __dirname,
                "index.html"
            );

        res.sendFile(
            indexPath,
            error => {
                if (error) {
                    return next(error);
                }
            }
        );
    }
);

/* ============================================================
   HEALTH CHECK
============================================================ */

app.get(
    "/api/health",
    async (req, res) => {
        try {
            const result =
                await pool.query(
                    "SELECT NOW() AS database_time"
                );

            return res.status(200).json({
                success: true,
                database: "connected",
                service:
                    "ProPulse Sports Portal",
                timestamp:
                    new Date().toISOString(),
                database_time:
                    result.rows[0].database_time
            });
        } catch (error) {
            console.error(
                "Health check database error:",
                error.message
            );

            return res.status(503).json({
                success: false,
                database: "unavailable",
                service:
                    "ProPulse Sports Portal",
                error:
                    NODE_ENV === "production"
                        ? "Database unavailable."
                        : error.message
            });
        }
    }
);

/* ============================================================
   AUTH LOGIN
============================================================ */

app.post(
    "/api/auth/login",
    async (req, res) => {
        try {
            const username =
                clean(
                    req.body.username,
                    100
                );

            const pin =
                String(
                    req.body.pin || ""
                );

            if (!username || !pin) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Username and password are required."
                });
            }

            const result =
                await pool.query(
                    `
                        SELECT
                            id,
                            username,
                            pin,
                            role
                        FROM users
                        WHERE username = $1
                        LIMIT 1
                    `,
                    [username]
                );

            if (
                result.rows.length === 0
            ) {
                return res.status(401).json({
                    success: false,
                    error:
                        "Invalid username or password."
                });
            }

            const user =
                result.rows[0];

            let passwordMatches =
                false;

            if (
                user.pin &&
                user.pin.startsWith("$2")
            ) {
                passwordMatches =
                    await bcrypt.compare(
                        pin,
                        user.pin
                    );
            } else {
                /*
                 * Backward compatibility for
                 * existing plaintext passwords.
                 */
                passwordMatches =
                    pin === user.pin;

                if (passwordMatches) {
                    const upgradedHash =
                        await bcrypt.hash(
                            pin,
                            12
                        );

                    await pool.query(
                        `
                            UPDATE users
                            SET pin = $1
                            WHERE id = $2
                        `,
                        [
                            upgradedHash,
                            user.id
                        ]
                    );
                }
            }

            if (!passwordMatches) {
                return res.status(401).json({
                    success: false,
                    error:
                        "Invalid username or password."
                });
            }

            const token =
                createAuthToken(user);

            res.cookie(
                "propulse_auth",
                token,
                {
                    httpOnly: true,

                    secure:
                        NODE_ENV ===
                        "production",

                    sameSite: "lax",

                    maxAge:
                        8 *
                        60 *
                        60 *
                        1000,

                    path: "/"
                }
            );

            return res.json({
                success: true,
                username:
                    user.username,
                role:
                    user.role
            });
        } catch (error) {
            console.error(
                "Login error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to authenticate."
            });
        }
    }
);

/* ============================================================
   AUTH SESSION
============================================================ */

app.get(
    "/api/auth/me",
    authenticate,
    async (req, res) => {
        return res.json({
            success: true,
            username:
                req.user.username,
            role:
                req.user.role
        });
    }
);

/* ============================================================
   AUTH LOGOUT
============================================================ */

app.post(
    "/api/auth/logout",
    (req, res) => {
        res.clearCookie(
            "propulse_auth",
            {
                httpOnly: true,

                secure:
                    NODE_ENV ===
                    "production",

                sameSite: "lax",

                path: "/"
            }
        );

        return res.json({
            success: true
        });
    }
);

/* ============================================================
   GET PORTAL CONTENT
============================================================ */

app.get(
    "/api/content",
    async (req, res) => {
        try {
            const [
                posts,
                adverts,
                users,
                settings
            ] = await Promise.all([
                pool.query(`
                    SELECT
                        id,
                        type,
                        title,
                        body,
                        media_url,
                        category,
                        author,
                        created_at,
                        updated_at
                    FROM posts
                    ORDER BY
                        created_at DESC,
                        id DESC
                `),

                pool.query(`
                    SELECT
                        id,
                        title,
                        media_url,
                        body,
                        target_url,
                        media_type,
                        created_at
                    FROM adverts
                    ORDER BY
                        created_at DESC,
                        id DESC
                `),

                /*
                 * NEVER expose password/PIN hashes.
                 */
                pool.query(`
                    SELECT
                        id,
                        username,
                        role,
                        created_at
                    FROM users
                    ORDER BY username ASC
                `),

                pool.query(`
                    SELECT
                        setting_key,
                        setting_value
                    FROM site_settings
                `)
            ]);

            const settingMap = {};

            settings.rows.forEach(
                setting => {
                    settingMap[
                        setting.setting_key
                    ] =
                        setting.setting_value;
                }
            );

            return res.json({
                success: true,

                all_posts:
                    posts.rows,

                adverts:
                    adverts.rows,

                users:
                    users.rows,

                settings: {
                    whatsapp_phone:
                        settingMap.whatsapp_phone ||
                        "256700000000",

                    whatsapp_message:
                        settingMap.whatsapp_message ||
                        "Hello ProPulse Sports, I am reaching out from your live portal!"
                }
            });
        } catch (error) {
            console.error(
                "Content loading error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to load portal data."
            });
        }
    }
);

/* ============================================================
   CREATE / UPDATE POST
============================================================ */

app.post(
    "/api/admin/publish",
    authenticate,
    async (req, res) => {
        try {
            const id =
                validId(req.body.id);

            const type =
                clean(
                    req.body.type,
                    50
                );

            const title =
                clean(
                    req.body.title,
                    300
                );

            const body =
                clean(
                    req.body.body,
                    30000
                );

            const media_url =
                clean(
                    req.body.media_url,
                    2000
                );

            const category =
                clean(
                    req.body.category ||
                        type,
                    100
                );

            if (
                !type ||
                !title ||
                !body
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Category, title and story body are required."
                });
            }

            /* =================================================
               UPDATE EXISTING POST
            ================================================= */

            if (id) {
                const existing =
                    await pool.query(
                        `
                            SELECT
                                id,
                                author
                            FROM posts
                            WHERE id = $1
                        `,
                        [id]
                    );

                if (
                    existing.rows.length === 0
                ) {
                    return res.status(404).json({
                        success: false,
                        error:
                            "Story not found."
                    });
                }

                if (
                    req.user.role !==
                        "admin" &&
                    existing.rows[0].author !==
                        req.user.username
                ) {
                    return res.status(403).json({
                        success: false,
                        error:
                            "You can only edit your own stories."
                    });
                }

                const result =
                    await pool.query(
                        `
                            UPDATE posts
                            SET
                                type = $1,
                                title = $2,
                                body = $3,
                                media_url = $4,
                                category = $5,
                                updated_at = NOW()
                            WHERE id = $6
                            RETURNING *
                        `,
                        [
                            type,
                            title,
                            body,
                            media_url,
                            category,
                            id
                        ]
                    );

                return res.json({
                    success: true,
                    post:
                        result.rows[0]
                });
            }

            /* =================================================
               CREATE NEW POST
            ================================================= */

            const result =
                await pool.query(
                    `
                        INSERT INTO posts
                            (
                                type,
                                title,
                                body,
                                media_url,
                                category,
                                author
                            )
                        VALUES
                            (
                                $1,
                                $2,
                                $3,
                                $4,
                                $5,
                                $6
                            )
                        RETURNING *
                    `,
                    [
                        type,
                        title,
                        body,
                        media_url,
                        category,
                        req.user.username
                    ]
                );

            return res.status(201).json({
                success: true,
                post:
                    result.rows[0]
            });
        } catch (error) {
            console.error(
                "Publish error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to save story."
            });
        }
    }
);

/* ============================================================
   DELETE POST
============================================================ */

app.delete(
    "/api/admin/posts/:id",
    authenticate,
    async (req, res) => {
        try {
            const id =
                validId(
                    req.params.id
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid story ID."
                });
            }

            const existing =
                await pool.query(
                    `
                        SELECT
                            id,
                            author
                        FROM posts
                        WHERE id = $1
                    `,
                    [id]
                );

            if (
                existing.rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Story not found."
                });
            }

            if (
                req.user.role !== "admin" &&
                existing.rows[0].author !==
                    req.user.username
            ) {
                return res.status(403).json({
                    success: false,
                    error:
                        "You can only delete your own stories."
                });
            }

            await pool.query(
                `
                    DELETE FROM posts
                    WHERE id = $1
                `,
                [id]
            );

            return res.json({
                success: true
            });
        } catch (error) {
            console.error(
                "Delete post error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to delete story."
            });
        }
    }
);

/* ============================================================
   CREATE BLOGGER
============================================================ */

app.post(
    "/api/admin/bloggers",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const username =
                clean(
                    req.body.username,
                    100
                );

            const pin =
                String(
                    req.body.pin || ""
                );

            if (!username || !pin) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Username and password are required."
                });
            }

            if (pin.length < 4) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Password must contain at least 4 characters."
                });
            }

            const passwordHash =
                await bcrypt.hash(
                    pin,
                    12
                );

            const result =
                await pool.query(
                    `
                        INSERT INTO users
                            (
                                username,
                                pin,
                                role
                            )
                        VALUES
                            (
                                $1,
                                $2,
                                'blogger'
                            )
                        RETURNING
                            id,
                            username,
                            role,
                            created_at
                    `,
                    [
                        username,
                        passwordHash
                    ]
                );

            return res.status(201).json({
                success: true,
                user:
                    result.rows[0]
            });
        } catch (error) {
            if (
                error.code === "23505"
            ) {
                return res.status(409).json({
                    success: false,
                    error:
                        "Username already exists."
                });
            }

            console.error(
                "Create blogger error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to create blogger account."
            });
        }
    }
);

/* ============================================================
   DELETE BLOGGER
============================================================ */

app.delete(
    "/api/admin/bloggers/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const id =
                validId(
                    req.params.id
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid user ID."
                });
            }

            const result =
                await pool.query(
                    `
                        DELETE FROM users
                        WHERE
                            id = $1
                            AND role = 'blogger'
                        RETURNING id
                    `,
                    [id]
                );

            if (
                result.rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Blogger not found."
                });
            }

            return res.json({
                success: true
            });
        } catch (error) {
            console.error(
                "Delete blogger error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to delete blogger."
            });
        }
    }
);

/* ============================================================
   UPDATE PASSWORD
============================================================ */

app.post(
    "/api/admin/update-password",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const username =
                clean(
                    req.body.username,
                    100
                );

            const newPin =
                String(
                    req.body.new_pin || ""
                );

            const confirmPin =
                String(
                    req.body.confirm_pin ||
                        ""
                );

            if (
                !username ||
                !newPin
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Username and new password are required."
                });
            }

            if (
                newPin !== confirmPin
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "New passwords do not match."
                });
            }

            if (newPin.length < 4) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Password must contain at least 4 characters."
                });
            }

            const passwordHash =
                await bcrypt.hash(
                    newPin,
                    12
                );

            const result =
                await pool.query(
                    `
                        UPDATE users
                        SET pin = $1
                        WHERE username = $2
                        RETURNING
                            id,
                            username,
                            role
                    `,
                    [
                        passwordHash,
                        username
                    ]
                );

            if (
                result.rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    error:
                        "User not found."
                });
            }

            return res.json({
                success: true
            });
        } catch (error) {
            console.error(
                "Password update error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to update password."
            });
        }
    }
);

/* ============================================================
   CREATE ADVERT
============================================================ */

app.post(
    "/api/admin/adverts",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const title =
                clean(
                    req.body.title,
                    300
                );

            const media_url =
                clean(
                    req.body.media_url,
                    2000
                );

            const body =
                clean(
                    req.body.body,
                    10000
                );

            const target_url =
                clean(
                    req.body.target_url,
                    2000
                );

            const media_type =
                clean(
                    req.body.media_type ||
                        "image",
                    30
                );

            if (!title) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Advertisement title is required."
                });
            }

            const result =
                await pool.query(
                    `
                        INSERT INTO adverts
                            (
                                title,
                                media_url,
                                body,
                                target_url,
                                media_type
                            )
                        VALUES
                            (
                                $1,
                                $2,
                                $3,
                                $4,
                                $5
                            )
                        RETURNING *
                    `,
                    [
                        title,
                        media_url,
                        body,
                        target_url,
                        media_type
                    ]
                );

            return res.status(201).json({
                success: true,
                advert:
                    result.rows[0]
            });
        } catch (error) {
            console.error(
                "Advert creation error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to create advertisement."
            });
        }
    }
);

/* ============================================================
   DELETE ADVERT
============================================================ */

app.delete(
    "/api/admin/adverts/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const id =
                validId(
                    req.params.id
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid advertisement ID."
                });
            }

            const result =
                await pool.query(
                    `
                        DELETE FROM adverts
                        WHERE id = $1
                        RETURNING id
                    `,
                    [id]
                );

            if (
                result.rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Advertisement not found."
                });
            }

            return res.json({
                success: true
            });
        } catch (error) {
            console.error(
                "Delete advert error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to delete advertisement."
            });
        }
    }
);

/* ============================================================
   WHATSAPP SETTINGS
============================================================ */

app.post(
    "/api/admin/settings/whatsapp",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const phone =
                clean(
                    req.body.phone,
                    50
                );

            const message =
                clean(
                    req.body.message,
                    1000
                );

            if (
                !phone ||
                !message
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "WhatsApp phone number and message are required."
                });
            }

            await pool.query(
                `
                    INSERT INTO site_settings
                        (
                            setting_key,
                            setting_value,
                            updated_at
                        )
                    VALUES
                        (
                            'whatsapp_phone',
                            $1,
                            NOW()
                        )
                    ON CONFLICT (setting_key)
                    DO UPDATE SET
                        setting_value =
                            EXCLUDED.setting_value,
                        updated_at =
                            NOW()
                `,
                [phone]
            );

            await pool.query(
                `
                    INSERT INTO site_settings
                        (
                            setting_key,
                            setting_value,
                            updated_at
                        )
                    VALUES
                        (
                            'whatsapp_message',
                            $1,
                            NOW()
                        )
                    ON CONFLICT (setting_key)
                    DO UPDATE SET
                        setting_value =
                            EXCLUDED.setting_value,
                        updated_at =
                            NOW()
                `,
                [message]
            );

            return res.json({
                success: true
            });
        } catch (error) {
            console.error(
                "WhatsApp settings error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to save WhatsApp settings."
            });
        }
    }
);

/* ============================================================
   API 404 HANDLER
   IMPORTANT:
   This comes BEFORE the frontend fallback.
============================================================ */

app.use(
    "/api",
    (req, res) => {
        return res.status(404).json({
            success: false,
            error:
                "API endpoint not found.",
            path:
                req.originalUrl
        });
    }
);

/* ============================================================
   STATIC FRONTEND
============================================================ */

app.use(
    express.static(
        path.join(__dirname),
        {
            index: "index.html"
        }
    )
);

/* ============================================================
   FRONTEND FALLBACK
   Express 4 + Express 5 compatible.

   Do NOT use app.get("*") here.
============================================================ */

app.use(
    (req, res, next) => {
        if (
            req.method !== "GET" &&
            req.method !== "HEAD"
        ) {
            return next();
        }

        if (
            req.path.startsWith("/api/")
        ) {
            return next();
        }

        const indexPath =
            path.join(
                __dirname,
                "index.html"
            );

        return res.sendFile(
            indexPath,
            error => {
                if (error) {
                    return next(error);
                }
            }
        );
    }
);

/* ============================================================
   404 HANDLER
============================================================ */

app.use(
    (req, res) => {
        return res.status(404).json({
            success: false,
            error:
                "Resource not found."
        });
    }
);

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
    (err, req, res, next) => {
        console.error(
            "Unhandled server error:",
            err
        );

        if (res.headersSent) {
            return next(err);
        }

        return res.status(500).json({
            success: false,
            error:
                NODE_ENV === "production"
                    ? "Internal server error."
                    : err.message ||
                      "Internal server error."
        });
    }
);

/* ============================================================
   START SERVER
============================================================ */

async function startServer() {
    /*
     * IMPORTANT:
     *
     * Start Express FIRST.
     *
     * Previously, initDB() ran before app.listen().
     * If Supabase/PostgreSQL was unreachable, Render
     * could never reach /api/health.
     */

    const server =
        app.listen(
            PORT,
            "0.0.0.0",
            () => {
                console.log(
                    "================================================"
                );

                console.log(
                    "ProPulse Sports Portal"
                );

                console.log(
                    `Server listening on port ${PORT}`
                );

                console.log(
                    `Environment: ${NODE_ENV}`
                );

                console.log(
                    `Health endpoint: /api/health`
                );

                console.log(
                    "================================================"
                );
            }
        );

    /*
     * Initialize the database after the HTTP server
     * has started.
     */
    try {
        await initDB();

        console.log(
            "ProPulse database initialization completed."
        );
    } catch (error) {
        /*
         * Keep the HTTP server alive so /api/health can
         * tell us that the database is unavailable.
         */
        console.error(
            "WARNING: Database initialization failed."
        );

        console.error(
            "Database error:",
            error.message
        );

        console.error(
            "The HTTP server remains online."
        );

        console.error(
            "Check DATABASE_URL and PostgreSQL/Supabase connectivity."
        );
    }

    /*
     * Graceful shutdown.
     */
    const shutdown =
        async signal => {
            console.log(
                `${signal} received. Shutting down gracefully...`
            );

            server.close(
                async () => {
                    try {
                        await pool.end();

                        console.log(
                            "Database pool closed."
                        );

                        process.exit(0);
                    } catch (error) {
                        console.error(
                            "Shutdown error:",
                            error.message
                        );

                        process.exit(1);
                    }
                }
            );

            setTimeout(
                () => {
                    console.error(
                        "Forced shutdown after timeout."
                    );

                    process.exit(1);
                },
                10000
            ).unref();
        };

    process.once(
        "SIGTERM",
        () => shutdown("SIGTERM")
    );

    process.once(
        "SIGINT",
        () => shutdown("SIGINT")
    );
}

startServer();
