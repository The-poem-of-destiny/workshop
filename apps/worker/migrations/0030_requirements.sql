ALTER TABLE projects ADD COLUMN requirements TEXT CHECK(requirements IS NULL OR
  (json_valid(requirements) AND json_extract(requirements,'$.schemaVersion') = 1
    AND json_type(requirements,'$.dependencies') = 'array'
    AND json_type(requirements,'$.conflicts') = 'array'
    AND json_type(requirements,'$.notes') = 'text'));
ALTER TABLE project_revisions ADD COLUMN requirements TEXT CHECK(requirements IS NULL OR
  (json_valid(requirements) AND json_extract(requirements,'$.schemaVersion') = 1
    AND json_type(requirements,'$.dependencies') = 'array'
    AND json_type(requirements,'$.conflicts') = 'array'
    AND json_type(requirements,'$.notes') = 'text'));
UPDATE projects SET requirements = json_object('schemaVersion',1,'dependencies',json('[]'),
  'conflicts',json('[]'),'notes',precautions) WHERE precautions IS NOT NULL;
UPDATE project_revisions SET requirements = json_object('schemaVersion',1,'dependencies',json('[]'),
  'conflicts',json('[]'),'notes',precautions) WHERE precautions IS NOT NULL;
ALTER TABLE projects DROP COLUMN precautions;
ALTER TABLE project_revisions DROP COLUMN precautions;
