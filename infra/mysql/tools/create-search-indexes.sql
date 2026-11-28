-- Restores the property search indexes (the opposite of drop-search-indexes.sql).
ALTER TABLE properties ADD INDEX ix_properties_city (city);
ALTER TABLE properties ADD INDEX ix_properties_status_price (status, nightly_price);
