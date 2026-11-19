import { InstallDialog } from "../features/installed/InstallDialog";
import { InstallInstanceChoice } from "../features/installed/InstallInstanceChoice";
import type { useHostConnection } from "../features/installed/useHostConnection";
import type { useInstalledProjects } from "../features/installed/useInstalledProjects";
import { DiscordLinkPrompt, type DiscordPromptTarget } from "../features/policy/DiscordLinkPrompt";
import { PolicyGateDialog } from "../features/policy/PolicyGateDialog";
import { WorkshopFaqDialog } from "../features/policy/WorkshopFaqDialog";
import type { useWorkshopSession } from "./useWorkshopSession";

export function WorkshopGlobalDialogs({
  policyDialogOpen,
  setPolicyDialogOpen,
  pendingPolicyUser,
  policyState,
  completePolicy,
  logout,
  discordPrompt,
  setDiscordPrompt,
  faqOpen,
  setFaqOpen,
  communityInviteUrl,
  me,
  installTarget,
  setInstallTarget,
  bridge,
  context,
  completeInstall,
  instanceChoice,
  setInstanceChoice,
  installing,
  prepareInstall,
  instanceOperation,
  installedItems,
}: {
  policyDialogOpen: boolean;
  setPolicyDialogOpen: (open: boolean) => void;
  pendingPolicyUser: ReturnType<typeof useWorkshopSession>["pendingPolicyUser"];
  policyState: ReturnType<typeof useWorkshopSession>["policyState"];
  completePolicy: ReturnType<typeof useWorkshopSession>["completePolicy"];
  logout: ReturnType<typeof useWorkshopSession>["logout"];
  discordPrompt: DiscordPromptTarget | null;
  setDiscordPrompt: (target: DiscordPromptTarget | null) => void;
  faqOpen: boolean;
  setFaqOpen: (open: boolean) => void;
  communityInviteUrl: string;
  me: ReturnType<typeof useWorkshopSession>["me"];
  installTarget: ReturnType<typeof useHostConnection>["installTarget"];
  setInstallTarget: ReturnType<typeof useHostConnection>["setInstallTarget"];
  bridge: ReturnType<typeof useHostConnection>["bridge"];
  context: ReturnType<typeof useHostConnection>["context"];
  completeInstall: ReturnType<typeof useHostConnection>["completeInstall"];
  instanceChoice: ReturnType<typeof useHostConnection>["instanceChoice"];
  setInstanceChoice: ReturnType<typeof useHostConnection>["setInstanceChoice"];
  installing: ReturnType<typeof useHostConnection>["installing"];
  prepareInstall: ReturnType<typeof useHostConnection>["prepareInstall"];
  instanceOperation: ReturnType<typeof useHostConnection>["instanceOperation"];
  installedItems: ReturnType<typeof useInstalledProjects>["installedItems"];
}) {
  return (
    <>
      <PolicyGateDialog
        open={policyDialogOpen}
        onOpenChange={setPolicyDialogOpen}
        pendingUser={pendingPolicyUser}
        policyState={policyState}
        onCompleted={completePolicy}
        onLogout={logout}
      />

      <DiscordLinkPrompt
        target={discordPrompt}
        communityInviteUrl={communityInviteUrl}
        onClose={() => setDiscordPrompt(null)}
      />

      <WorkshopFaqDialog
        open={faqOpen}
        onOpenChange={setFaqOpen}
        communityInviteUrl={communityInviteUrl}
        onOpenPolicy={() => setPolicyDialogOpen(true)}
      />

      {me && installTarget && bridge ? (
        <InstallDialog
          open
          projectTitle={installTarget.title}
          intent={installTarget.intent}
          scan={context?.installationScan ?? null}
          bridge={bridge}
          primary={context?.worldbooks?.primary ?? null}
          onCompleted={completeInstall}
          onClose={() => setInstallTarget(null)}
        />
      ) : null}
      <InstallInstanceChoice
        instanceChoice={me ? instanceChoice : null}
        setInstanceChoice={setInstanceChoice}
        installing={installing}
        prepareInstall={prepareInstall}
        instanceOperation={instanceOperation}
        installedItems={installedItems}
      />
    </>
  );
}
