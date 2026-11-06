// Load server dependencies and configure the database connection.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const databasePath = process.env.DB_FILE || path.join(__dirname, 'cafe_portal.db');
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const port = Number(process.env.PORT) || 3000;
const db = new sqlite3.Database(databasePath);
db.on('error', error => console.error('SQLite error:', error));
let writeQueue = Promise.resolve();

app.use(express.json({ limit: '100kb' }));

// Promise wrappers keep SQLite queries usable with async/await.
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) reject(error);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows);
        });
    });
}

// Serialize writes so order and ticket updates do not overlap.
function withWriteLock(action) {
    const operation = writeQueue.then(action, action);
    writeQueue = operation.catch(() => {});
    return operation;
}

// Verify the bearer token before allowing access to protected routes.
function requireLogin(req, res, next) {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });

    try {
        req.user = jwt.verify(token, jwtSecret);
        next();
    } catch {
        res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
}

// Public routes for health checks, menu data, and support tickets.
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/menu', async (req, res, next) => {
    try {
        const items = await all(
            'SELECT id, name, category, price, description AS desc, badge, image_url AS img FROM menu_items WHERE is_available = 1 ORDER BY id'
        );
        res.json(items);
    } catch (error) {
        next(error);
    }
});

app.post('/api/support', async (req, res, next) => {
    const body = req.body || {};
    const role = String(body.role || '');
    const category = String(body.category || '');
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    const allowedRoles = ['customer', 'staff'];
    const allowedCategories = ['Order issue', 'Payment', 'Account access', 'Menu or availability', 'Other'];

    if (!allowedRoles.includes(role) || !allowedCategories.includes(category) ||
        !fullName || fullName.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        !subject || subject.length > 120 || !message || message.length > 2000) {
        return res.status(400).json({ error: 'Complete each field with valid information and try again.' });
    }

    try {
        const result = await withWriteLock(() => run(
            'INSERT INTO support_tickets (role, category, full_name, email, subject, message) VALUES (?, ?, ?, ?, ?, ?)',
            [role, category, fullName, email, subject, message]
        ));
        res.status(201).json({ message: 'Your support ticket has been submitted.', ticketId: result.lastID });
    } catch (error) {
        next(error);
    }
});

// Authentication routes for customer registration and sign-in.
app.post('/api/auth/register', async (req, res, next) => {
    const body = req.body || {};
    const userId = String(body.userId || '').trim();
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = body.password;

    if (!/^\d{11}$/.test(userId) || !fullName || fullName.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ error: 'Enter an 11-digit student ID, valid name and email, and a password from 8 to 72 bytes.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await withWriteLock(() => run(
            'INSERT INTO users (user_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [userId, fullName, email, passwordHash, 'customer']
        ));
        res.status(201).json({ message: 'Account created. You can now sign in.', id: result.lastID });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: 'That ID or email is already registered.' });
        }
        next(error);
    }
});

app.post('/api/auth/login', async (req, res, next) => {
    const body = req.body || {};
    const userId = String(body.userId || '').trim();
    const password = body.password;
    if (!userId || typeof password !== 'string') {
        return res.status(400).json({ error: 'Enter your ID and password.' });
    }

    try {
        const user = await get('SELECT * FROM users WHERE user_id = ?', [userId]);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid ID or password.' });
        }

        const token = jwt.sign(
            { id: user.id, userId: user.user_id, role: user.role },
            jwtSecret,
            { expiresIn: '2h' }
        );
        res.json({
            token,
            user: {
                id: user.user_id,
                name: user.full_name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/account', requireLogin, async (req, res, next) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ error: 'Only customer accounts can be deleted here.' });
    }

    const password = req.body?.password;
    if (typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Enter your password to confirm account deletion.' });
    }

    try {
        const deleted = await withWriteLock(async () => {
            const user = await get(
                'SELECT password_hash FROM users WHERE id = ? AND role = ?',
                [req.user.id, 'customer']
            );
            if (!user || !(await bcrypt.compare(password, user.password_hash))) return false;

            await run('BEGIN IMMEDIATE');
            try {
                const result = await run('DELETE FROM users WHERE id = ? AND role = ?', [req.user.id, 'customer']);
                if (!result.changes) {
                    await run('ROLLBACK');
                    return false;
                }
                await run('COMMIT');
                return true;
            } catch (error) {
                await run('ROLLBACK');
                throw error;
            }
        });

        if (!deleted) return res.status(401).json({ error: 'The password is incorrect or the account no longer exists.' });
        res.json({ message: 'Your account and order history have been permanently deleted.' });
    } catch (error) {
        next(error);
    }
});

// Protected routes for reading and placing the signed-in user's orders.
app.get('/api/orders', requireLogin, async (req, res, next) => {
    try {
        const orders = await all(
            `SELECT o.id, o.order_number AS orderNumber, o.total_amount AS totalAmount,
                    o.payment_method AS paymentMethod, o.status, o.created_at AS createdAt,
                    GROUP_CONCAT(oi.quantity || 'x ' || m.name, ', ') AS items
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             JOIN menu_items m ON m.id = oi.menu_item_id
             WHERE o.user_id = ?
             GROUP BY o.id
             ORDER BY o.id DESC`,
            [req.user.id]
        );
        res.json(orders);
    } catch (error) {
        next(error);
    }
});

app.post('/api/orders', requireLogin, async (req, res, next) => {
    const { items, paymentMethod } = req.body || {};
    const allowedPayments = ['Cash', 'GCash', 'Maya', 'Bank transfer'];
    if (!Array.isArray(items) || items.length === 0 || items.length > 50 || !allowedPayments.includes(paymentMethod)) {
        return res.status(400).json({ error: 'Add items to your cart and choose a payment method.' });
    }

    const quantities = new Map();
    for (const item of items) {
        const id = Number(item.id);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(id) || id < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            return res.status(400).json({ error: 'Your cart contains an invalid item or quantity.' });
        }
        const totalQuantity = (quantities.get(id) || 0) + quantity;
        if (totalQuantity > 99) {
            return res.status(400).json({ error: 'Each item is limited to 99 per order.' });
        }
        quantities.set(id, totalQuantity);
    }

    try {
        const ids = [...quantities.keys()];
        const menuItems = await all(
            `SELECT id, price FROM menu_items WHERE is_available = 1 AND id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        if (menuItems.length !== ids.length) {
            return res.status(400).json({ error: 'One or more items are no longer available.' });
        }

        const total = Math.round(menuItems.reduce((sum, item) => sum + item.price * quantities.get(item.id), 0) * 100) / 100;
        const orderNumber = `CP-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        await withWriteLock(async () => {
            await run('BEGIN IMMEDIATE');
            try {
                const result = await run(
                    'INSERT INTO orders (order_number, user_id, total_amount, payment_method) VALUES (?, ?, ?, ?)',
                    [orderNumber, req.user.id, total, paymentMethod]
                );
                for (const item of menuItems) {
                    await run(
                        'INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                        [result.lastID, item.id, quantities.get(item.id), item.price]
                    );
                }
                await run('COMMIT');
            } catch (error) {
                await run('ROLLBACK');
                throw error;
            }
        });

        res.status(201).json({ orderNumber, totalAmount: total });
    } catch (error) {
        next(error);
    }
});

// Serve the portal files and return a consistent response for server errors.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'App Dev.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'The server could not complete your request.' });
});

// Initialize the schema and starter menu before accepting requests.
async function start() {
    try {
        await run('PRAGMA foreign_keys = ON');
        await new Promise((resolve, reject) => {
            db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'), error => {
                if (error) reject(error);
                else resolve();
            });
        });

        const menuCount = await get('SELECT COUNT(*) AS count FROM menu_items');
        if (menuCount.count === 0) {
            const menu = [
                ['Adobo with Rice', 'Meals', 60, 'Filipino-style adobo served with rice.', '', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSPJ7cm7Sp6TUdkdOeD_YmqAamUJaNy_lJgLxbJfTOEUQ&s']
            ];
            for (const item of menu) {
                await run(
                    'INSERT INTO menu_items (name, category, price, description, badge, image_url) VALUES (?, ?, ?, ?, ?, ?)',
                    item
                );
            }
        }

        app.listen(port, () => {
            console.log(`Café Portal is ready at http://localhost:${port}`);
            console.log(`SQLite database: ${databasePath}`);
        });
    } catch (error) {
        console.error('Could not start Café Portal:', error);
        db.close(() => process.exit(1));
    }
}

start();
