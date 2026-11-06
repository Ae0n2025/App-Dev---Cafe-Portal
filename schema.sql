PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'staff', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Meals', 'Drinks', 'Snacks')),
    price REAL NOT NULL CHECK (price >= 0),
    description TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'GCash', 'Maya', 'Bank transfer')),
    status TEXT NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'DONE', 'CANCELLED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('customer', 'staff')),
    category TEXT NOT NULL CHECK (category IN ('Order issue', 'Payment', 'Account access', 'Menu or availability', 'Other')),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
