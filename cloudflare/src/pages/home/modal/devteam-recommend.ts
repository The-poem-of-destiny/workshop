export const homeDevTeamRecommendModalScript = String.raw`
function openDevTeamRecommendationModal(project) {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以推荐作品', 'error');
    return;
  }
  if (!project?.id || project.status !== 'approved' || !project.isPublished || project.visibility === false) {
    showToast('只能推荐已经公开发布的项目', 'warning');
    return;
  }

  const existing = getMyDevTeamRecommendation(project.id);
  const curator = existing?.curator
    || (state.devTeamCurators || []).find(item => item?.id === state.currentUser.id)
    || null;
  const bio = String(curator?.bio || '');
  const comment = String(existing?.recommendation?.comment || '');
  const removeButton = existing
    ? '<button type="button" class="btn btn-outline" id="removeDevTeamRecommendation"><i class="fas fa-xmark"></i> 取消推荐</button>'
    : '';
  const html = '<form id="devTeamRecommendationForm" class="devteam-editor-form">'
    + '<div class="devteam-editor-project"><small>正在推荐</small><strong>' + escapeHtml(project.name || '未命名项目') + '</strong></div>'
    + '<label><span>我的推荐者简介 <small>会显示在你的推荐区标题旁</small></span><input id="devTeamCuratorBio" type="text" maxlength="160" value="' + escapeHtml(bio) + '" placeholder="例如：偏爱剧情向、世界观与奇怪小工具"></label>'
    + '<label><span>推荐语</span><textarea id="devTeamRecommendationComment" maxlength="500" required placeholder="用你自己的语气说说为什么推荐这个作品">' + escapeHtml(comment) + '</textarea></label>'
    + '<div class="devteam-editor-actions">' + removeButton + '<button type="submit" class="btn btn-primary"><i class="fas fa-thumbs-up"></i> ' + (existing ? '更新推荐' : '推荐这个作品') + '</button></div>'
    + '<p class="devteam-editor-note">每位管理员的推荐会独立显示，不会合并成 Workshop 官方评分。</p></form>';

  const overlay = openModal(html, '<i class="fas fa-user-pen"></i> DevTeam Recommend');
  const form = overlay.querySelector('#devTeamRecommendationForm');
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const nextBio = overlay.querySelector('#devTeamCuratorBio').value.trim();
    const nextComment = overlay.querySelector('#devTeamRecommendationComment').value.trim();
    if (!nextComment) {
      showToast('写一句推荐语再保存喵', 'warning');
      return;
    }
    submit.disabled = true;
    try {
      await saveDevTeamRecommendation(project.id, nextComment, nextBio);
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast(existing ? '推荐已更新' : '已经加入你的 DevTeam 推荐');
      renderApp();
    } catch (error) {
      showToast('保存推荐失败: ' + (error?.message || String(error)), 'error');
      submit.disabled = false;
    }
  };

  const remove = overlay.querySelector('#removeDevTeamRecommendation');
  if (remove) {
    remove.onclick = async () => {
      if (!confirm('取消你对这个作品的推荐吗？')) return;
      remove.disabled = true;
      try {
        await deleteDevTeamRecommendation(project.id);
        overlay.dataset.dirty = 'false';
        overlay.remove();
        showToast('已取消推荐');
        renderApp();
      } catch (error) {
        showToast('取消推荐失败: ' + (error?.message || String(error)), 'error');
        remove.disabled = false;
      }
    };
  }
}
`;
