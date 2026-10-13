-- Run against an EMPTY scratch database after migrating. Never run on production.
-- Each "expect FAIL" statement must error; each "expect OK" must succeed.
\set ON_ERROR_STOP 0
INSERT INTO leagues (id,name,slug) VALUES ('00000000-0000-0000-0000-00000000000a','League A','a'),('00000000-0000-0000-0000-00000000000b','League B','b');
INSERT INTO venues (id,league_id,name) VALUES ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Craft Brewery'),('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Venue D');
INSERT INTO players (id,league_id,display_name) VALUES ('20000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Hank'),('20000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Rosa');
INSERT INTO tournaments (id,league_id,venue_id,name,scheduled_at,public_code,created_by) VALUES ('30000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Friday',now(),'K7Q4MX','u');
\echo '[1] expect FAIL: league B tournament at a league A venue'
INSERT INTO tournaments (league_id,venue_id,name,scheduled_at,public_code,created_by) VALUES ('00000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000a','X',now(),'AAAAAA','u');
\echo '[2] expect FAIL: league B player into league A tournament (claiming league A)'
INSERT INTO tournament_registrations (league_id,tournament_id,player_id) VALUES ('00000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000b');
\echo '[3] expect FAIL: league B player into league A tournament (claiming league B)'
INSERT INTO tournament_registrations (league_id,tournament_id,player_id) VALUES ('00000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000b');
\echo '[4] expect OK: same-league registration'
INSERT INTO tournament_registrations (id,league_id,tournament_id,player_id) VALUES ('40000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000a');
\echo '[5] expect FAIL: duplicate registration'
INSERT INTO tournament_registrations (league_id,tournament_id,player_id) VALUES ('00000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000a');
\echo '[6] expect OK: check-in'
INSERT INTO player_check_ins (registration_id,tournament_id) VALUES ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a');
\echo '[7] expect FAIL: second active check-in'
INSERT INTO player_check_ins (registration_id,tournament_id) VALUES ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a');
\echo '[8] expect OK: re-check-in after the first is voided'
UPDATE player_check_ins SET voided_at=now();
INSERT INTO player_check_ins (registration_id,tournament_id) VALUES ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a');
\echo '[9] expect OK then FAIL: duplicate active elimination'
INSERT INTO player_eliminations (registration_id,tournament_id,order_key) VALUES ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a',1);
INSERT INTO player_eliminations (registration_id,tournament_id,order_key) VALUES ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a',1);
\echo '[10] expect FAIL: check-in pointing at a registration from another tournament id'
UPDATE player_check_ins SET voided_at=now() WHERE voided_at IS NULL;
INSERT INTO player_check_ins (registration_id,tournament_id) VALUES ('40000000-0000-0000-0000-00000000000a','99999999-0000-0000-0000-000000000000');
\echo '[11] expect FAIL: big blind smaller than small blind'
INSERT INTO blind_levels (tournament_id,position,small_blind,big_blind,duration_sec) VALUES ('30000000-0000-0000-0000-00000000000a',0,400,200,600);
\echo '[12] expect FAIL: venue staff who is not a league member'
INSERT INTO venue_memberships (league_id,venue_id,user_id) VALUES ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','stranger');
\echo '[13] expect FAIL: duplicate public code'
INSERT INTO tournaments (league_id,venue_id,name,scheduled_at,public_code,created_by) VALUES ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Dup',now(),'K7Q4MX','u');
\echo '[14] expect FAIL: two active winners in one tournament'
INSERT INTO players (id,league_id,display_name) VALUES ('20000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','Nia');
INSERT INTO tournament_registrations (id,league_id,tournament_id,player_id) VALUES ('40000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000c');
UPDATE player_eliminations SET is_winner = true WHERE voided_at IS NULL;
INSERT INTO player_eliminations (registration_id,tournament_id,order_key,is_winner) VALUES ('40000000-0000-0000-0000-00000000000c','30000000-0000-0000-0000-00000000000a',2,true);
