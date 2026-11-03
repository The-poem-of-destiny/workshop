ALTER TABLE project_revisions ADD COLUMN entry_index TEXT
  CHECK(entry_index IS NULL OR (json_valid(entry_index)
    AND json_extract(entry_index,'$.schemaVersion') = 1
    AND json_type(entry_index,'$.entries') = 'array'
    AND length(CAST(entry_index AS BLOB)) <= 512000));
UPDATE project_revisions SET entry_index = json_object('schemaVersion',1,'entries',json(COALESCE((
  SELECT json_group_array(json_object('kind',kind,'entryKey',entry_key,'name',name,
    'contentHash',content_hash,'contentLength',content_length))
  FROM (SELECT kind,entry_key,name,content_hash,content_length FROM revision_entry_index
    WHERE revision_id = project_revisions.id ORDER BY kind,entry_key)
),'[]'))) WHERE entry_index_ready = 1;
DROP TABLE revision_entry_index;
ALTER TABLE project_revisions DROP COLUMN entry_index_ready;
