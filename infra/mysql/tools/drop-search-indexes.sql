-- Removes the property search indexes, for the "search latency with and without indexes"
-- experiment (spec 9). Run:  docker compose exec -T mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD xenia < infra/mysql/tools/drop-search-indexes.sql
-- Put them back with create-search-indexes.sql.
ALTER TABLE properties DROP INDEX ix_properties_city;
ALTER TABLE properties DROP INDEX ix_properties_status_price;
