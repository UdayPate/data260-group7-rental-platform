-- A read-only MySQL user for Himja's AI service (it may read listings, hosts, availability and
-- reservations, never write). Development password only: change it for anything real.
-- The database name is the one the container creates (MYSQL_DATABASE, default xenia).
CREATE USER IF NOT EXISTS 'ai_reader'@'%' IDENTIFIED BY 'ai_reader_dev';
GRANT SELECT ON xenia.properties         TO 'ai_reader'@'%';
GRANT SELECT ON xenia.hosts              TO 'ai_reader'@'%';
GRANT SELECT ON xenia.availability_blocks TO 'ai_reader'@'%';
GRANT SELECT ON xenia.availability_nights TO 'ai_reader'@'%';
GRANT SELECT ON xenia.reservations       TO 'ai_reader'@'%';
FLUSH PRIVILEGES;
