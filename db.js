const sqlite3 = require("sqlite3").verbose();

// Connect to SQLite database (creates users.db if not exists)
const db = new sqlite3.Database("./users.db", (err) => {
  if (err) {
    console.error("❌ Error opening database:", err.message);
  } else {
    console.log("✅ Connected to SQLite database.");
  }
});

// Create users table (if it does not exist already)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error("❌ Error creating users table:", err.message);
    } else {
      console.log("✅ Users table ready.");
    }
  });
});

module.exports = db;
