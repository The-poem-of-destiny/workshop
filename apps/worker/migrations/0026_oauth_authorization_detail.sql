-- Authorization evidence only: OAuth and PKCE secrets retain their existing
-- dedicated columns and must never be copied into this JSON document.
ALTER TABLE oauth_flows ADD COLUMN detail TEXT
  CHECK (detail IS NULL OR (json_valid(detail)
    AND json_extract(detail, '$.schemaVersion') = 1
    AND json_type(detail, '$.guildId') = 'text'
    AND json_extract(detail, '$.eligibility') = 'member'
    AND json_type(detail, '$.verifiedAt') = 'text'));
UPDATE oauth_flows SET detail = json_object(
  'schemaVersion', 1, 'guildId', guild_id, 'eligibility', 'member',
  'verifiedAt', strftime('%Y-%m-%dT%H:%M:%fZ', authorized_at)
) WHERE guild_id IS NOT NULL AND authorized_at IS NOT NULL;
ALTER TABLE oauth_flows DROP COLUMN guild_id;
