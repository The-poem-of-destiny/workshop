export const homeAppBootstrapScript = String.raw`
  function renderApp() {
    applyContentFont(state.contentFont);
    const filteredProjects = getFilteredProjects();
    app.innerHTML = renderLayout(filteredProjects);
    bindStaticActions(filteredProjects);
    bindCoverImageFallbacks();
  }

  async function init() {
    if (window.__CW_TAVERN_MOCK__) {
      setTavernConnectionStatus('connected');
      setInstalledProjects(window.__CW_TAVERN_MOCK__.installedProjects || []);
      (window.__CW_TAVERN_MOCK__.projectDiffs || []).forEach(item => {
        setProjectUpdateDiff(item.projectId, item.diff);
      });
    } else {
      initializeTavernBridge();
    }
    resetProjectPagination();
    const authState = await fetchCurrentUser();
    if (authState?.user) {
      clearPendingOAuth();
    } else {
      resumeEmbeddedOAuthPolling();
    }
    showRejectedProjectReminder(authState?.rejectedProjects);
    await fetchDiscoverBanner().catch(error => console.warn('[CreativeWorkshop] Banner 配置加载失败', error));
    await fetchDiscoverShelves(false);
  }

  init();
`;
