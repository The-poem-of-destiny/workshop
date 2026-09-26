export const homeDevTeamRecommendModalScript = String.raw`
function openDlcKitchenCuratorModal(curatorId) {
  const curator = (state.devTeamCurators || []).find(item => item?.id === curatorId);
  if (!curator) {
    showToast('找不到这位私房主理人的资料', 'warning');
    return;
  }

  const recommendations = Array.isArray(curator.recommendations)
    ? curator.recommendations.filter(item => item?.project)
    : [];
  const avatar = curator.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = curator.name || '私房主理人';
  const title = String(curator.title || '').trim() || 'DLC 私房主理人';
  const bio = String(curator.bio || '').trim();
  const itemsHtml = recommendations.map(item => {
    const reaction = String(item.reactionLabel || '').trim() || '推荐';
    const comment = String(item.comment || '').trim();
    return '<div class="dlc-kitchen-full-item">'
      + renderDiscoverCard(item.project)
      + '<div class="dlc-kitchen-full-copy"><span class="dlc-kitchen-reaction">' + escapeHtml(reaction) + '</span>'
      + (comment ? '<p>' + escapeHtml(comment) + '</p>' : '')
      + '</div></div>';
  }).join('');

  const html = '<div class="dlc-kitchen-full">'
    + '<header class="dlc-kitchen-full-head"><img src="' + escapeHtml(avatar) + '" alt=""><div><small>' + escapeHtml(name) + '</small><h3>' + escapeHtml(title) + '</h3>'
    + (bio ? '<p>' + escapeHtml(bio) + '</p>' : '')
    + '<span>' + recommendations.length + ' 道私房菜</span></div></header>'
    + '<div class="dlc-kitchen-full-grid">' + itemsHtml + '</div></div>';

  const overlay = openModal(html, '<i class="fas fa-bowl-food"></i> DLC私房菜');
  overlay.querySelectorAll('.discover-card').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('.like-btn')) return;
      const projectId = card.dataset.id;
      const item = recommendations.find(candidate => candidate?.project?.id === projectId);
      if (!item?.project) return;
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showProjectDetail(item.project);
    });
  });
  overlay.querySelectorAll('.like-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.id) toggleLike(button.dataset.id);
    });
  });
}

function openDevTeamRecommendationModal(project) {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以添加私房菜', 'error');
    return;
  }
  if (!project?.id || project.status !== 'approved' || !project.isPublished || project.visibility === false) {
    showToast('只能加入已经公开发布的项目', 'warning');
    return;
  }

  const existing = getMyDevTeamRecommendation(project.id);
  const curator = existing?.curator
    || (state.devTeamCurators || []).find(item => item?.id === state.currentUser.id)
    || null;
  const title = String(curator?.title || '');
  const bio = String(curator?.bio || '');
  const reactionLabel = String(existing?.recommendation?.reactionLabel || '');
  const comment = String(existing?.recommendation?.comment || '');
  const removeButton = existing
    ? '<button type="button" class="btn btn-outline" id="removeDevTeamRecommendation"><i class="fas fa-xmark"></i> 移出私房菜</button>'
    : '';
  const html = '<form id="devTeamRecommendationForm" class="devteam-editor-form">'
    + '<div class="devteam-editor-project"><small>正在加入私房菜</small><strong>' + escapeHtml(project.name || '未命名项目') + '</strong></div>'
    + '<label><span>个人称号 <small>显示在头像旁，属于你自己的栏目</small></span><input id="devTeamCuratorTitle" type="text" maxlength="48" value="' + escapeHtml(title) + '" placeholder="例如：冷门扩展鉴赏家"></label>'
    + '<label><span>一句简介 <small>可选</small></span><input id="devTeamCuratorBio" type="text" maxlength="160" value="' + escapeHtml(bio) + '" placeholder="例如：偏爱剧情向、世界观与奇怪小工具"></label>'
    + '<label><span>短 reaction <small>可用 emoji · 留空则显示「推荐」</small></span><input id="devTeamReactionLabel" type="text" maxlength="32" value="' + escapeHtml(reactionLabel) + '" placeholder="🔥 私藏 / 🫶 常驻 / 😭 神"></label>'
    + '<label><span>推荐语</span><textarea id="devTeamRecommendationComment" maxlength="500" required placeholder="用你自己的语气说说为什么把它放进私房菜">' + escapeHtml(comment) + '</textarea></label>'
    + '<div class="devteam-editor-actions">' + removeButton + '<button type="submit" class="btn btn-primary"><i class="fas fa-bowl-food"></i> ' + (existing ? '更新这道菜' : '加入私房菜') + '</button></div>'
    + '<p class="devteam-editor-note">称号属于你本人；reaction 和推荐语属于这一个作品。不同管理员互不覆盖。</p></form>';

  const overlay = openModal(html, '<i class="fas fa-user-pen"></i> DLC私房菜');
  const form = overlay.querySelector('#devTeamRecommendationForm');
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const nextTitle = overlay.querySelector('#devTeamCuratorTitle').value.trim();
    const nextBio = overlay.querySelector('#devTeamCuratorBio').value.trim();
    const nextReactionLabel = overlay.querySelector('#devTeamReactionLabel').value.trim();
    const nextComment = overlay.querySelector('#devTeamRecommendationComment').value.trim();
    if (!nextComment) {
      showToast('写一句推荐语再保存喵', 'warning');
      return;
    }
    submit.disabled = true;
    try {
      await saveDevTeamRecommendation(project.id, {
        title: nextTitle,
        bio: nextBio,
        reactionLabel: nextReactionLabel,
        comment: nextComment,
      });
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast(existing ? '私房菜已更新' : '已经加入你的 DLC私房菜');
      renderApp();
    } catch (error) {
      showToast('保存私房菜失败: ' + (error?.message || String(error)), 'error');
      submit.disabled = false;
    }
  };

  const remove = overlay.querySelector('#removeDevTeamRecommendation');
  if (remove) {
    remove.onclick = async () => {
      if (!confirm('把这个作品移出你的私房菜吗？')) return;
      remove.disabled = true;
      try {
        await deleteDevTeamRecommendation(project.id);
        overlay.dataset.dirty = 'false';
        overlay.remove();
        showToast('已移出私房菜');
        renderApp();
      } catch (error) {
        showToast('移出私房菜失败: ' + (error?.message || String(error)), 'error');
        remove.disabled = false;
      }
    };
  }
}
`;
