-- Withdrawal preserves the frozen submission and check history. Its terminal
-- status remains superseded; withdrawn_at distinguishes the author's action.
ALTER TABLE submissions ADD COLUMN withdrawn_at TEXT;
ALTER TABLE submissions ADD COLUMN withdrawn_by TEXT REFERENCES users(id);
