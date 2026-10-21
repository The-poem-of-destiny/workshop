-- Bind an OAuth flow to the browser that created it. The cookie is HttpOnly;
-- only its SHA-256 is stored, and callback/status/redeem must present it.
ALTER TABLE oauth_flows ADD COLUMN browser_binding_hash TEXT;
