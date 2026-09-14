-- Isolated browser-test identity, confirmed by the merchant.
-- Applied only to .wrangler/e2e. No catalogue, stock or service claims are added.
UPDATE store_settings SET value = 'Covers by Mobile' WHERE key = 'business.brand_name';
INSERT INTO store_settings
  (id, key, value, value_type, category, gates_feature, is_sensitive, created_at, updated_at)
VALUES
  ('test_brand_secondary', 'business.brand_secondary', 'Zam Zam', 'string', 'business', 0, 0, 0, 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
