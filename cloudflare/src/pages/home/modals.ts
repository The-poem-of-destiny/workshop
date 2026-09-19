import { homeModalCoreScript } from './modal/core';
import { homeProjectDetailModalScript } from './modal/project-detail';
import { homeProjectUpdateModalScript } from './modal/project-update';
import { homeProjectInstallModalScript } from './modal/project-install';
import { homeProjectEditorModalScript } from './modal/project-editor';
import { homeAdminReviewModalScript } from './modal/admin-review';
import { homeAdminToolsModalScript } from './modal/admin-tools';

export const homeModalsScript = [
  homeModalCoreScript,
  homeProjectDetailModalScript,
  homeProjectUpdateModalScript,
  homeProjectInstallModalScript,
  homeProjectEditorModalScript,
  homeAdminReviewModalScript,
  homeAdminToolsModalScript,
].join('\n');
