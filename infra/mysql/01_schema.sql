-- Xenia: MySQL schema (spec 3.2). Runs once when the MySQL container starts on an empty volume.
--
-- WHY MySQL for these tables: accounts, listings, availability and reservations are
-- transactional data. Two people can book the same nights at the same moment, and only a
-- database with transactions, unique keys and row locks can make exactly one of them win.
-- Flexible documents (reviews, messages, AI debates, event traces) live in MongoDB instead
-- (see infra/mongo/init.js).
--
-- Conventions (docs/api/data-contract.md section 1):
--   * ids are strings such as 'p_001' (the id_counters table hands out the next number)
--   * dates are DATE, datetimes are DATETIME(3) and always UTC (the server runs with +00:00)
--   * money is DECIMAL dollars (never cents)
--   * check_out / end_date are EXCLUSIVE: a stay 12-04 to 12-06 holds the nights of 12-04 and 12-05

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------------------
-- Ids. next_value is the number the NEXT new row of that prefix gets (g, h, p, r, a).
-- Used as: UPDATE id_counters SET next_value = LAST_INSERT_ID(next_value + 1) ...
-- which is atomic, so two requests never receive the same id.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS id_counters (
  prefix     VARCHAR(10) NOT NULL PRIMARY KEY,
  next_value BIGINT      NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------------------
-- User Service
-- ---------------------------------------------------------------------------------------
-- The login table. One account = one role. utf8mb4_unicode_ci compares text ignoring
-- upper/lower case, so the UNIQUE key on email is case-insensitive (contract: emails unique).
CREATE TABLE IF NOT EXISTS accounts (
  email         VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  password_hash VARCHAR(100) NOT NULL,                       -- bcrypt, cost 10
  role          ENUM('guest','host','admin') NOT NULL,
  user_id       VARCHAR(20)  NOT NULL,                       -- guest_id, host_id or admin id
  PRIMARY KEY (email),
  UNIQUE KEY uq_accounts_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guests (
  guest_id                 VARCHAR(20)  NOT NULL PRIMARY KEY,
  first_name               VARCHAR(100) NOT NULL,
  last_name                VARCHAR(100) NOT NULL,
  email                    VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  phone                    VARCHAR(50)  NOT NULL DEFAULT '',
  location                 VARCHAR(200) NOT NULL DEFAULT '',
  profile_photo_url        VARCHAR(500) NOT NULL DEFAULT '',
  preferences              JSON         NOT NULL,           -- {preferred_locations, max_nightly_price, property_types, amenities}
  profile_created_datetime DATETIME(3)  NOT NULL,
  -- saved_properties_count and booking_count are NOT stored: they are counted from
  -- saved_properties and reservations on every read, so they can never drift.
  KEY ix_guests_email (email),
  KEY ix_guests_location (location)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hosts (
  host_id             VARCHAR(20)  NOT NULL PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  email               VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  phone               VARCHAR(50)  NOT NULL DEFAULT '',
  profile_photo_url   VARCHAR(500) NOT NULL DEFAULT '',
  verification_status ENUM('verified','pending','unverified') NOT NULL DEFAULT 'unverified',
  response_rate       INT          NOT NULL DEFAULT 0,       -- percent 0-100
  response_time       INT          NOT NULL DEFAULT 0,       -- average minutes to reply
  host_since          DATE         NOT NULL,
  access_level        ENUM('standard','superhost') NOT NULL DEFAULT 'standard',
  KEY ix_hosts_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------------------
-- Property Service
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  property_id      VARCHAR(20)   NOT NULL PRIMARY KEY,
  host_id          VARCHAR(20)   NOT NULL,
  title            VARCHAR(200)  NOT NULL,
  description      TEXT          NOT NULL,
  property_type    ENUM('house','apartment','condo','townhouse','private_room','guest_suite') NOT NULL,
  address          VARCHAR(255)  NOT NULL,
  city             VARCHAR(100)  NOT NULL,
  state            VARCHAR(50)   NOT NULL,
  zip_code         VARCHAR(20)   NOT NULL,
  latitude         DECIMAL(9,6)  NOT NULL DEFAULT 0,
  longitude        DECIMAL(9,6)  NOT NULL DEFAULT 0,
  capacity         INT           NOT NULL,
  bedrooms         INT           NOT NULL,
  bathrooms        DECIMAL(3,1)  NOT NULL,
  amenities        JSON          NOT NULL,                  -- ["wifi","kitchen",...]
  nightly_price    DECIMAL(10,2) NOT NULL,
  cleaning_fee     DECIMAL(10,2) NOT NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  rating           DECIMAL(3,2)  NOT NULL DEFAULT 0,
  review_count     INT           NOT NULL DEFAULT 0,
  created_datetime DATETIME(3)   NOT NULL,
  photo_url        VARCHAR(500)  NOT NULL DEFAULT '',
  CONSTRAINT fk_properties_host FOREIGN KEY (host_id) REFERENCES hosts (host_id),
  CONSTRAINT ck_properties_capacity CHECK (capacity >= 1),
  CONSTRAINT ck_properties_price CHECK (nightly_price > 0),
  -- The search indexes. infra/mysql/drop-search-indexes.sql removes them for the
  -- "search with and without indexes" experiment (spec 9); create-search-indexes.sql restores them.
  KEY ix_properties_city (city),
  KEY ix_properties_status_price (status, nightly_price),
  KEY ix_properties_host (host_id)
) ENGINE=InnoDB;

-- Which guest saved which property (the heart on a listing card).
CREATE TABLE IF NOT EXISTS saved_properties (
  guest_id       VARCHAR(20) NOT NULL,
  property_id    VARCHAR(20) NOT NULL,
  saved_datetime DATETIME(3) NOT NULL,
  PRIMARY KEY (guest_id, property_id),
  CONSTRAINT fk_saved_guest    FOREIGN KEY (guest_id)    REFERENCES guests (guest_id)         ON DELETE CASCADE,
  CONSTRAINT fk_saved_property FOREIGN KEY (property_id) REFERENCES properties (property_id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per block of dates: a host block (source 'host') or a reservation hold (source 'booking').
-- end_date is exclusive.
CREATE TABLE IF NOT EXISTS availability_blocks (
  availability_id  VARCHAR(20) NOT NULL PRIMARY KEY,
  property_id      VARCHAR(20) NOT NULL,
  start_date       DATE        NOT NULL,
  end_date         DATE        NOT NULL,
  status           ENUM('available','blocked','booked') NOT NULL,
  source           ENUM('host','booking','system') NOT NULL,
  reservation_id   VARCHAR(20) NULL,                         -- set for source 'booking'
  updated_datetime DATETIME(3) NOT NULL,
  CONSTRAINT fk_blocks_property FOREIGN KEY (property_id) REFERENCES properties (property_id) ON DELETE CASCADE,
  CONSTRAINT ck_blocks_dates CHECK (end_date > start_date),
  KEY ix_blocks_property_dates (property_id, start_date, end_date),
  KEY ix_blocks_reservation (reservation_id)
) ENGINE=InnoDB;

-- THE DOUBLE-BOOKING GUARD (spec 13.1 and 13.3).
-- One row per property per night that is taken. PRIMARY KEY (property_id, night_date) means
-- MySQL itself refuses a second row for the same night, so two requests can never both
-- succeed, however close together they arrive. A block (host or booking) inserts all its
-- nights in ONE transaction; if any night is taken the insert fails with a duplicate-key
-- error and the whole block is rolled back.
CREATE TABLE IF NOT EXISTS availability_nights (
  property_id     VARCHAR(20) NOT NULL,
  night_date      DATE        NOT NULL,
  availability_id VARCHAR(20) NOT NULL,
  PRIMARY KEY (property_id, night_date),
  KEY ix_nights_block (availability_id),
  CONSTRAINT fk_nights_property FOREIGN KEY (property_id) REFERENCES properties (property_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------------------
-- Booking Service
-- ---------------------------------------------------------------------------------------
-- No foreign keys to guests / properties on purpose: contract rule "past reservations are kept"
-- when a guest deletes their profile or a host deletes a listing.
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id      VARCHAR(20)   NOT NULL PRIMARY KEY,
  trace_id            CHAR(36)      NOT NULL,
  property_id         VARCHAR(20)   NOT NULL,
  guest_id            VARCHAR(20)   NOT NULL,
  check_in            DATE          NOT NULL,
  check_out           DATE          NOT NULL,                 -- exclusive
  guest_count         INT           NOT NULL,
  nights              INT           NOT NULL,
  nightly_price       DECIMAL(10,2) NOT NULL,
  subtotal            DECIMAL(10,2) NOT NULL,
  cleaning_fee        DECIMAL(10,2) NOT NULL,
  total               DECIMAL(10,2) NOT NULL,
  booking_datetime    DATETIME(3)   NOT NULL,
  status              ENUM('processing','pending','approved','declined','cancelled','completed','failed') NOT NULL,
  cancellation_reason TEXT          NULL,
  failure_code        ENUM('DATE_CONFLICT','DUPLICATE_BOOKING') NULL,
  guest_message       TEXT          NULL,
  updated_datetime    DATETIME(3)   NOT NULL,
  CONSTRAINT ck_reservations_dates CHECK (check_out > check_in),
  KEY ix_reservations_guest (guest_id),
  KEY ix_reservations_property_status (property_id, status),
  KEY ix_reservations_trace (trace_id),
  KEY ix_reservations_status_dates (status, check_in, check_out)
) ENGINE=InnoDB;

-- Every status change, so a reservation can be reconstructed after a restart (spec 10).
CREATE TABLE IF NOT EXISTS reservation_status_history (
  history_id     BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reservation_id VARCHAR(20) NOT NULL,
  old_status     VARCHAR(20) NULL,
  new_status     VARCHAR(20) NOT NULL,
  actor_id       VARCHAR(50) NOT NULL,
  trace_id       CHAR(36)    NOT NULL,
  note           VARCHAR(500) NULL,
  changed_at     DATETIME(3) NOT NULL,
  KEY ix_history_reservation (reservation_id, history_id),
  KEY ix_history_trace (trace_id)
) ENGINE=InnoDB;

-- API-side idempotency: the same idempotency_key returns the first result (contract rule 5).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(100) NOT NULL,
  scope           VARCHAR(30)  NOT NULL,                      -- request, approve, decline, cancel
  reservation_id  VARCHAR(20)  NOT NULL,
  created_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (idempotency_key)
) ENGINE=InnoDB;

-- Consumer-side idempotency (spec 6.2 at-least-once delivery). A consumer inserts
-- (consumer_group, idempotency_key) in the SAME transaction as its database change, so a
-- crash can never leave "change done, key missing" or "key saved, change missing" (spec 13.2).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer_group  VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  event_type      VARCHAR(60)  NOT NULL,
  trace_id        CHAR(36)     NOT NULL,
  processed_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (consumer_group, idempotency_key)
) ENGINE=InnoDB;
