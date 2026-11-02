-- Content lives only on versions. Search is a derived published-version projection.
DROP TRIGGER project_search_insert;
DROP TRIGGER project_search_update;
DROP TRIGGER project_search_author_update;
DROP VIEW project_search_short_source;
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_update;
ALTER TABLE projects DROP COLUMN title;
ALTER TABLE projects DROP COLUMN description;
ALTER TABLE projects DROP COLUMN author_note;
ALTER TABLE projects DROP COLUMN project_type;
ALTER TABLE projects DROP COLUMN extension_type;
ALTER TABLE projects DROP COLUMN search_tags;
ALTER TABLE projects DROP COLUMN version_label;
ALTER TABLE projects DROP COLUMN requirements;
ALTER TABLE projects DROP COLUMN cover_position_x;
ALTER TABLE projects DROP COLUMN cover_position_y;
ALTER TABLE projects DROP COLUMN cover_zoom;
ALTER TABLE projects DROP COLUMN published_schema_version;
ALTER TABLE projects DROP COLUMN published_discord_thread_url;

CREATE VIEW project_search_short_source AS
SELECT p.rowid AS project_rowid,
 (WITH RECURSIVE chars(text,n) AS (
   SELECT COALESCE(r.title,'') || char(31) || COALESCE(r.project_type,'') || char(31)
     || COALESCE(r.extension_type,'') || char(31) || COALESCE(u.global_name,'') || char(31)
     || COALESCE(u.username,'') || char(31)
     || COALESCE((SELECT group_concat(tag,char(31)) FROM project_search_tags t WHERE t.project_id=p.id),'') ,1
   UNION ALL SELECT text,n+1 FROM chars WHERE n<length(text)
 ) SELECT group_concat(substr(text,n,1),' ') FROM chars) AS spaced_text
FROM projects p JOIN project_revisions r ON r.id=p.published_revision_id
JOIN users u ON u.id=p.author_id;

DELETE FROM project_search_tags;
INSERT INTO project_search_tags(project_id,tag)
SELECT p.id,j.value FROM projects p JOIN project_revisions r ON r.id=p.published_revision_id,
 json_each(r.tags) j WHERE j.type='text' AND j.value<>''
UNION SELECT p.id,r.extension_type FROM projects p JOIN project_revisions r ON r.id=p.published_revision_id
WHERE r.extension_type IS NOT NULL AND r.extension_type<>'';
DELETE FROM project_search;
INSERT INTO project_search(rowid,title,project_type,extension_type,tag_text,author_name)
SELECT p.rowid,r.title,r.project_type,r.extension_type,
 COALESCE((SELECT group_concat(tag,' ') FROM project_search_tags t WHERE t.project_id=p.id),''),
 COALESCE(u.global_name,u.username)
FROM projects p JOIN project_revisions r ON r.id=p.published_revision_id JOIN users u ON u.id=p.author_id;
DELETE FROM project_search_short;
INSERT INTO project_search_short(rowid,spaced_text) SELECT project_rowid,spaced_text FROM project_search_short_source;

CREATE TRIGGER project_search_update AFTER UPDATE OF published_revision_id,author_id ON projects
BEGIN
 DELETE FROM project_search_tags WHERE project_id=NEW.id;
 INSERT INTO project_search_tags(project_id,tag)
 SELECT NEW.id,j.value FROM project_revisions r,json_each(r.tags) j
 WHERE r.id=NEW.published_revision_id AND j.type='text' AND j.value<>''
 UNION SELECT NEW.id,r.extension_type FROM project_revisions r
 WHERE r.id=NEW.published_revision_id AND r.extension_type IS NOT NULL AND r.extension_type<>'';
 DELETE FROM project_search WHERE rowid=NEW.rowid;
 INSERT INTO project_search(rowid,title,project_type,extension_type,tag_text,author_name)
 SELECT NEW.rowid,r.title,r.project_type,r.extension_type,
 COALESCE((SELECT group_concat(tag,' ') FROM project_search_tags t WHERE t.project_id=NEW.id),''),
 (SELECT COALESCE(global_name,username) FROM users WHERE id=NEW.author_id)
 FROM project_revisions r WHERE r.id=NEW.published_revision_id;
 DELETE FROM project_search_short WHERE rowid=NEW.rowid;
 INSERT INTO project_search_short(rowid,spaced_text)
 SELECT project_rowid,spaced_text FROM project_search_short_source WHERE project_rowid=NEW.rowid;
END;

-- Supports import order where the published pointer is inserted before its version.
CREATE TRIGGER project_search_version_insert AFTER INSERT ON project_revisions
WHEN EXISTS(SELECT 1 FROM projects WHERE published_revision_id=NEW.id)
BEGIN
 UPDATE projects SET published_revision_id=published_revision_id WHERE published_revision_id=NEW.id;
END;

CREATE TRIGGER project_search_author_update AFTER UPDATE OF global_name,username ON users
WHEN OLD.global_name IS NOT NEW.global_name OR OLD.username IS NOT NEW.username
BEGIN
 UPDATE project_search SET author_name=COALESCE(NEW.global_name,NEW.username)
 WHERE rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
 DELETE FROM project_search_short WHERE rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
 INSERT INTO project_search_short(rowid,spaced_text)
 SELECT project_rowid,spaced_text FROM project_search_short_source
 WHERE project_rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
END;

