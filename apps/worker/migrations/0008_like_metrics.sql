CREATE TRIGGER project_like_metrics AFTER INSERT ON project_likes
BEGIN
  INSERT INTO project_metrics_daily (day_key, project_id, likes_delta)
  SELECT strftime('%Y-%m-%d', 'now'), NEW.project_id, 1
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta + 1;
END;

CREATE TRIGGER project_unlike_metrics AFTER DELETE ON project_likes
BEGIN
  INSERT INTO project_metrics_daily (day_key, project_id, likes_delta)
  SELECT strftime('%Y-%m-%d', 'now'), OLD.project_id, -1
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta - 1;
END;
