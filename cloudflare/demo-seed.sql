-- Disposable demo content for the personal frontend playground.
-- Safe to rerun: only demo-* rows are replaced.

DELETE FROM project_likes WHERE project_id LIKE 'demo-%';
DELETE FROM project_subscribes WHERE project_id LIKE 'demo-%';
DELETE FROM projects WHERE id LIKE 'demo-%';
DELETE FROM users WHERE id LIKE 'demo-user-%';

INSERT INTO users (id, username, global_name, avatar, discriminator, guilds, is_admin, created_at, updated_at) VALUES
('demo-user-aria', 'aria', 'Aria', '', '0', '[]', 0, '2026-08-20T09:00:00.000Z', '2026-09-02T09:00:00.000Z'),
('demo-user-noa', 'noa', 'Noa', '', '0', '[]', 0, '2026-08-21T09:00:00.000Z', '2026-09-02T09:00:00.000Z'),
('demo-user-lumi', 'lumi', 'Lumi', '', '0', '[]', 0, '2026-08-22T09:00:00.000Z', '2026-09-02T09:00:00.000Z'),
('demo-user-admin', 'demo-admin', 'Demo Admin', '', '0', '[]', 1, '2026-08-23T09:00:00.000Z', '2026-09-02T09:00:00.000Z');

INSERT INTO projects (
  id, name, description, version, author_id, author_name, author_avatar,
  status, download_url, file_size, downloads_count, tags, cover_image,
  created_at, updated_at, reviewed_at, reviewer_id, reject_reason,
  root_project_id, published_project_id, draft_project_id, review_target,
  visibility, is_published, latest_approved_at
) VALUES
('demo-aurora', 'Aurora Archive', 'A polished fantasy worldbook demo for card layout and typography.', '2.4.0', 'demo-user-aria', 'Aria', '', 'approved', NULL, 1835008, 842, '["世界书","奇幻","剧情"]', NULL, '2026-08-10T10:00:00.000Z', '2026-09-02T08:30:00.000Z', '2026-08-11T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-aurora', NULL, NULL, 'project', 1, 1, '2026-08-11T10:00:00.000Z'),
('demo-neon', 'Neon After Rain', 'Cyberpunk dialogue and ambience preset with a deliberately long description for responsive testing.', '1.8.2', 'demo-user-noa', 'Noa', '', 'approved', NULL, 943718, 1260, '["赛博朋克","对话","氛围"]', NULL, '2026-08-12T11:00:00.000Z', '2026-09-01T17:20:00.000Z', '2026-08-13T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-neon', NULL, NULL, 'project', 1, 1, '2026-08-13T10:00:00.000Z'),
('demo-teahouse', 'Moonlit Teahouse', 'Cozy slice-of-life scenario with compact metadata.', '3.0.1', 'demo-user-lumi', 'Lumi', '', 'approved', NULL, 524288, 319, '["日常","轻松"]', NULL, '2026-08-14T12:00:00.000Z', '2026-08-30T14:10:00.000Z', '2026-08-15T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-teahouse', NULL, NULL, 'project', 1, 1, '2026-08-15T10:00:00.000Z'),
('demo-academy', 'Arcane Academy Toolkit', 'Large modular academy toolkit used to test dense cards and many tags.', '4.2.2', 'demo-user-aria', 'Aria', '', 'approved', NULL, 3145728, 2048, '["学院","魔法","系统","大型"]', NULL, '2026-08-16T13:00:00.000Z', '2026-09-02T06:45:00.000Z', '2026-08-17T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-academy', NULL, NULL, 'project', 1, 1, '2026-08-17T10:00:00.000Z'),
('demo-noir', 'Noir Casebook', 'Mystery scenario pack.', '0.9.7', 'demo-user-noa', 'Noa', '', 'approved', NULL, 786432, 88, '["悬疑","调查"]', NULL, '2026-08-18T14:00:00.000Z', '2026-08-29T18:00:00.000Z', '2026-08-19T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-noir', NULL, NULL, 'project', 1, 1, '2026-08-19T10:00:00.000Z'),
('demo-ocean', 'Blue Hour Expedition', 'Ocean expedition world setting with a medium-length description.', '1.1.0', 'demo-user-lumi', 'Lumi', '', 'approved', NULL, 1572864, 507, '["冒险","海洋","世界书"]', NULL, '2026-08-20T15:00:00.000Z', '2026-08-31T11:35:00.000Z', '2026-08-21T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-ocean', NULL, NULL, 'project', 1, 1, '2026-08-21T10:00:00.000Z'),
('demo-empty-tags', 'Untitled Prototype', 'Useful for testing empty tags and sparse metadata.', '0.1.0', 'demo-user-aria', 'Aria', '', 'approved', NULL, NULL, 3, '[]', NULL, '2026-08-22T16:00:00.000Z', '2026-08-22T16:00:00.000Z', '2026-08-23T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-empty-tags', NULL, NULL, 'project', 1, 1, '2026-08-23T10:00:00.000Z'),
('demo-long-title', 'The Extremely Long Demonstration Project Name for Mobile Wrapping and Overflow Behaviour', 'Specifically created to expose truncation, wrapping, and narrow-screen layout problems.', '12.34.56', 'demo-user-noa', 'Noa', '', 'approved', NULL, 4194304, 9999, '["UI测试","长标题","移动端"]', NULL, '2026-08-24T17:00:00.000Z', '2026-09-02T07:55:00.000Z', '2026-08-25T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-long-title', NULL, NULL, 'project', 1, 1, '2026-08-25T10:00:00.000Z'),
('demo-hidden', 'Hidden Draft Example', 'Visible only in management views.', '1.0.0', 'demo-user-lumi', 'Lumi', '', 'approved', NULL, 65536, 14, '["隐藏"]', NULL, '2026-08-26T18:00:00.000Z', '2026-08-27T09:00:00.000Z', '2026-08-27T10:00:00.000Z', 'demo-user-admin', NULL, 'demo-hidden', NULL, NULL, 'project', 0, 1, '2026-08-27T10:00:00.000Z'),
('demo-pending', 'Pending Review Example', 'Pending item for admin/review UI.', '1.0.0', 'demo-user-aria', 'Aria', '', 'pending', NULL, 262144, 0, '["待审核"]', NULL, '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', NULL, NULL, NULL, 'demo-pending', NULL, NULL, 'project', 1, 0, NULL),
('demo-rejected', 'Rejected Example', 'Rejected item for error and review-state styling.', '0.8.0', 'demo-user-noa', 'Noa', '', 'rejected', NULL, 131072, 1, '["已拒绝"]', NULL, '2026-08-28T08:00:00.000Z', '2026-08-29T08:00:00.000Z', '2026-08-29T08:00:00.000Z', 'demo-user-admin', 'Demo rejection reason: missing required metadata.', 'demo-rejected', NULL, NULL, 'project', 1, 0, NULL);

INSERT OR IGNORE INTO project_likes (project_id, user_id, created_at) VALUES
('demo-aurora', 'demo-user-noa', '2026-09-01T10:00:00.000Z'),
('demo-aurora', 'demo-user-lumi', '2026-09-01T10:01:00.000Z'),
('demo-neon', 'demo-user-aria', '2026-09-01T10:02:00.000Z'),
('demo-neon', 'demo-user-lumi', '2026-09-01T10:03:00.000Z'),
('demo-neon', 'demo-user-admin', '2026-09-01T10:04:00.000Z'),
('demo-academy', 'demo-user-noa', '2026-09-01T10:05:00.000Z'),
('demo-academy', 'demo-user-lumi', '2026-09-01T10:06:00.000Z'),
('demo-academy', 'demo-user-admin', '2026-09-01T10:07:00.000Z'),
('demo-long-title', 'demo-user-aria', '2026-09-01T10:08:00.000Z');

INSERT OR IGNORE INTO project_subscribes (project_id, user_id, created_at) VALUES
('demo-aurora', 'demo-user-lumi', '2026-09-01T11:00:00.000Z'),
('demo-neon', 'demo-user-aria', '2026-09-01T11:01:00.000Z'),
('demo-academy', 'demo-user-noa', '2026-09-01T11:02:00.000Z'),
('demo-academy', 'demo-user-lumi', '2026-09-01T11:03:00.000Z'),
('demo-ocean', 'demo-user-aria', '2026-09-01T11:04:00.000Z');
