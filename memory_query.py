import sqlite3
import json
import os

DB_PATH = r'C:\Users\Alexnitro777\.local\share\mimocode\mimocode.db'
MEMORY_ROOT = r'C:\Users\Alexnitro777\.local\share\mimocode\memory'

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# List tables
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("=== TABLES ===")
for t in tables:
    print(t)

# List recent sessions
print("\n=== RECENT SESSIONS ===")
try:
    rows = db.execute("SELECT * FROM session ORDER BY rowid DESC LIMIT 10").fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f"session table error: {e}")

# Check message table
print("\n=== MESSAGE SAMPLE ===")
try:
    rows = db.execute("SELECT id, session_id, agent_id, time_created, substr(data, 1, 200) as preview FROM message ORDER BY rowid DESC LIMIT 5").fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f"message table error: {e}")

# Check part table
print("\n=== PART SAMPLE ===")
try:
    rows = db.execute("SELECT id, message_id, session_id, time_created, substr(data, 1, 200) as preview FROM part ORDER BY rowid DESC LIMIT 5").fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f"part table error: {e}")

db.close()
