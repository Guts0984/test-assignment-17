-- Hotels made by tests (e2e runs, fixtures) must never show up in the public hotel list.
ALTER TABLE hotel ADD COLUMN listed boolean NOT NULL DEFAULT true;

-- Hide the ones that already exist: e2e hotels (code E + 7 hex, name "E2E ...") and test fixtures (T / W + 8 hex).
UPDATE hotel SET listed = false
WHERE (code ~ '^E[0-9A-F]{7}$' AND name LIKE 'E2E %') OR code ~ '^[TW][0-9a-f]{8}$';
