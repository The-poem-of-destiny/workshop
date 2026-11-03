-- Existing arbitrary audit text is historical evidence, not a target action/detail.
-- Preserve its exact SQL text without inventing version attribution or parsing it.
UPDATE audit_events SET detail=json_object('sourceSchema','workshop-pre-target-cutover',
  'originalAction',action,'originalDetail',detail), action='legacy.current_schema_event';
CREATE TRIGGER audit_action_insert BEFORE INSERT ON audit_events
WHEN NEW.action NOT IN ('member.role_change','site.update','project.patch','project.delete',
  'submission.withdraw','submission.cutover_supersede','companion.publish',
  'recommendation.update','recommendation.delete','legacy.admin_added','legacy.admin_removed',
  'legacy.character_reference_created','legacy.character_reference_version_created',
  'legacy.editor_pick_removed','legacy.editor_pick_saved','legacy.current_schema_event')
BEGIN SELECT RAISE(ABORT,'unsupported audit action'); END;
CREATE TRIGGER audit_action_update BEFORE UPDATE OF action ON audit_events
WHEN NEW.action NOT IN ('member.role_change','site.update','project.patch','project.delete',
  'submission.withdraw','submission.cutover_supersede','companion.publish',
  'recommendation.update','recommendation.delete','legacy.admin_added','legacy.admin_removed',
  'legacy.character_reference_created','legacy.character_reference_version_created',
  'legacy.editor_pick_removed','legacy.editor_pick_saved','legacy.current_schema_event')
BEGIN SELECT RAISE(ABORT,'unsupported audit action'); END;
