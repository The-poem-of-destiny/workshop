import { homeApiScript } from './api';
import { homeModalsScript } from './modals';
import { homePresentationScript } from './presentation';
import { homePublishCheckScript } from './publish-check';
import { homeCardsRenderScript } from './render/cards';
import { homeDetailModalRenderScript } from './render/detail-modal';
import { homeReviewDiffRenderScript } from './render/review-diff';
import { homeLayoutRenderScript } from './render/layout';
import { homeRepairScript } from './repair-ui';
import { homeStateScript } from './state';
import { homeTavernBridgeScript } from './tavern-bridge';
import { homeUploadPreviewScript } from './upload-preview';
import { homeUtilsScript } from './utils';
import { PROJECT_CONTENT_POLICY } from '../../config/project-content-policy';
import { PROJECT_TAXONOMY } from '../../config/project-taxonomy';
import { homeAppAuthFlowScript } from './app/auth-flow';
import { homeAppActionsScript } from './app/actions';
import { homeAppBootstrapScript } from './app/bootstrap';

const projectContentPolicyJson = JSON.stringify(PROJECT_CONTENT_POLICY);
const projectTaxonomyJson = JSON.stringify(PROJECT_TAXONOMY);

export const homeScript = String.raw`
(function() {
  const app = document.getElementById('app');
  const PROJECT_CONTENT_POLICY = ${projectContentPolicyJson};
  const PROJECT_TAXONOMY = ${projectTaxonomyJson};

  ${homeStateScript}
  ${homeUtilsScript}
  ${homeTavernBridgeScript}
  ${homeApiScript}
  ${homeCardsRenderScript}
  ${homeDetailModalRenderScript}
  ${homeUploadPreviewScript}
  ${homeReviewDiffRenderScript}
  ${homeLayoutRenderScript}
  ${homePublishCheckScript}
  ${homeModalsScript}
  ${homeRepairScript}
  ${homePresentationScript}

${homeAppAuthFlowScript}

${homeAppActionsScript}

${homeAppBootstrapScript}
})();
`;
