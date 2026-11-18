import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function WorkshopFaqDialog({
  open,
  onOpenChange,
  communityInviteUrl,
  onOpenPolicy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityInviteUrl: string;
  onOpenPolicy: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="faq-dialog max-w-[600px]">
        <DialogHeader>
          <DialogTitle>使用帮助与常见问题</DialogTitle>
          <DialogDescription>关于账号验证、模组安装机制、反馈渠道与工坊规范的简要说明</DialogDescription>
        </DialogHeader>

        <div className="faq-dialog-body">
          <details className="faq-item">
            <summary>为什么 Discord 登录提示不在允许的服务器或缺少身份组？</summary>
            <div className="faq-answer">
              <p>
                创意工坊面向社区成员开放互动与下载功能。登录时会校验你的 Discord
                账号是否已加入社区服务器并完成基础验证。
              </p>
              <p>
                若尚未加入，可通过{" "}
                <a href={communityInviteUrl} target="_blank" rel="noopener noreferrer">
                  Discord 社区邀请入口
                </a>{" "}
                加入服务器并按指引领取身份组后再回到工坊重试登录。
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary>点击作品的 Discord 讨论链接提示无访问权限怎么办？</summary>
            <div className="faq-answer">
              <p>
                作品讨论帖位于社区服务器内部频道。请先确认当前浏览器或客户端登录的 Discord 账号已加入{" "}
                <a href={communityInviteUrl} target="_blank" rel="noopener noreferrer">
                  社区服务器
                </a>{" "}
                并拥有对应频道浏览权限。
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary>在 SillyTavern 中安装、更新、卸载模组会修改哪些本地内容？</summary>
            <div className="faq-answer">
              <p>
                安装模组时，客户端会向你选择的目标世界书或当前角色<strong>追加</strong>
                该模组拥有的条目，不会清空原有的其他世界书条目。
              </p>
              <p>
                更新已安装实例时，会整体替换该模组拥有的条目（你对该模组条目做过的本地修改不会保留）；卸载则移除该模组拥有的条目。为避免误操作造成存档损失，
                <strong>操作前请务必自行备份角色卡与世界书</strong>。
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary>使用某个模组时遇到报错、设定冲突或质量问题应该找谁？</summary>
            <div className="faq-answer">
              <p>
                工坊中的模组均由创作者独立制作并负责，官方不对第三方模组的内容、兼容性或使用后果承担担保责任。遇到问题时，请先阅读作品详情说明并联系该模组作者反馈，或先在「已安装」中卸载该模组排查。
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary>提交审核后发现还要修改，或者想暂时隐藏已发布作品怎么办？</summary>
            <div className="faq-answer">
              <p>
                在「我的项目」打开编辑页，审核中的版本可在顶部状态栏一键「撤回审核并继续修改」，不会影响线上已发布的旧版本。若想暂时隐藏项目，可在编辑页底部的可见性设置中切换为「仅自己可见」，无需删除项目。
              </p>
            </div>
          </details>
        </div>

        <div className="faq-dialog-footer">
          <button
            type="button"
            className="faq-policy-link"
            onClick={() => {
              onOpenChange(false);
              onOpenPolicy();
            }}
          >
            查看《创意工坊使用政策》全文
          </button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
