import { CURRENT_POLICY_VERSION, WORKSHOP_POLICY_CLAUSES, WORKSHOP_POLICY_QUESTIONS } from "@workshop/domain";
import { ArrowLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { ApiError, api, type MeResponse, type UserPolicyState } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function PolicyGateDialog({
  open,
  onOpenChange,
  pendingUser,
  policyState,
  onCompleted,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUser: MeResponse["user"] | null;
  policyState: UserPolicyState | null;
  onCompleted: (policy: UserPolicyState) => void;
  onLogout: () => void;
}) {
  const requiresQuiz = Boolean(pendingUser && !policyState?.accepted);
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [incorrectIds, setIncorrectIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = WORKSHOP_POLICY_QUESTIONS.every((question) => Boolean(answers[question.id]));

  function selectAnswer(questionId: string, optionId: string): void {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setIncorrectIds((prev) => prev.filter((id) => id !== questionId));
    setSubmitError(null);
  }

  async function submitQuiz(): Promise<void> {
    if (!agreed || !allAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setIncorrectIds([]);
    try {
      const response = await api.acceptPolicy({
        version: CURRENT_POLICY_VERSION,
        agreed: true,
        answers,
      });
      onCompleted(response.policy);
    } catch (reason) {
      if (reason instanceof ApiError) {
        const details = reason.details as { incorrectQuestionIds?: unknown } | undefined;
        if (details && Array.isArray(details.incorrectQuestionIds)) {
          setIncorrectIds(details.incorrectQuestionIds.filter((item): item is string => typeof item === "string"));
        }
        setSubmitError(reason.message.replace(/^\d+\s+[a-z_]+:\s*/i, "") || "提交未通过，请检查答案后重试。");
      } else {
        setSubmitError(String(reason));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent
        className={`policy-dialog mobile-sheet ${requiresQuiz ? "policy-dialog-wide max-w-[980px]" : "max-w-[660px]"}`}
      >
        <DialogHeader className="policy-dialog-header">
          <div className="detail-header-top">
            <button
              type="button"
              className="mobile-sheet-back"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft aria-hidden="true" />
              <span>返回</span>
            </button>
            <DialogTitle>创意工坊使用政策与须知</DialogTitle>
          </div>
          <DialogDescription>
            {requiresQuiz
              ? `你好，${pendingUser?.globalName || pendingUser?.username}。启用互动、安装与创作功能前，请确认以下须知并完成 3 道问答。`
              : `当前政策版本：${CURRENT_POLICY_VERSION}`}
          </DialogDescription>
        </DialogHeader>

        <div className={`policy-dialog-body${requiresQuiz ? " policy-split-grid" : ""}`}>
          <div className="policy-clauses-col">
            <div className="policy-clauses">
              {WORKSHOP_POLICY_CLAUSES.map((clause, index) => (
                <section key={clause.id} className="policy-clause">
                  <h4>
                    {index + 1}. {clause.title}
                  </h4>
                  <p>{clause.body}</p>
                </section>
              ))}
            </div>
            {requiresQuiz ? (
              <label className="policy-agree-check">
                <input
                  type="checkbox"
                  checked={agreed}
                  disabled={submitting}
                  onChange={(event) => {
                    setAgreed(event.target.checked);
                    setSubmitError(null);
                  }}
                />
                <span>我已阅读并同意上述《创意工坊使用政策》（{CURRENT_POLICY_VERSION}）</span>
              </label>
            ) : null}
          </div>

          {requiresQuiz ? (
            <div className="policy-quiz">
              <div className="policy-questions">
                <p className="policy-questions-lead">确认问答（共 3 题，全部答对后启用账号）：</p>
                {WORKSHOP_POLICY_QUESTIONS.map((question, qIndex) => {
                  const hasError = incorrectIds.includes(question.id);
                  return (
                    <fieldset
                      key={question.id}
                      className={`policy-question${hasError ? " policy-question-error" : ""}`}
                    >
                      <legend>
                        {qIndex + 1}. {question.prompt}
                      </legend>
                      <div className="policy-options">
                        {question.options.map((option) => (
                          <label
                            key={option.id}
                            className={`policy-option${answers[question.id] === option.id ? " is-selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name={`policy-q-${question.id}`}
                              value={option.id}
                              checked={answers[question.id] === option.id}
                              disabled={submitting}
                              onChange={() => selectAnswer(question.id, option.id)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                      {hasError ? <p className="policy-question-hint">此题与左侧须知不符，请重新核对。</p> : null}
                    </fieldset>
                  );
                })}
              </div>

              {submitError ? (
                <p className="policy-submit-error" role="alert">
                  <ShieldAlert aria-hidden="true" />
                  <span>{submitError}</span>
                </p>
              ) : null}
            </div>
          ) : policyState?.accepted ? (
            <p className="policy-accepted-note">
              <CheckCircle2 aria-hidden="true" />
              <span>
                你已确认当前版本政策（{policyState.acceptedVersion}
                {policyState.acceptedAt ? ` · ${policyState.acceptedAt.slice(0, 10)}` : ""}）。
              </span>
            </p>
          ) : null}
        </div>

        <div className="policy-dialog-actions">
          {requiresQuiz ? (
            <>
              <button
                type="button"
                className="policy-logout-link"
                disabled={submitting}
                onClick={() => {
                  onOpenChange(false);
                  onLogout();
                }}
              >
                退出此账号
              </button>
              <div className="policy-dialog-buttons">
                <Button type="button" variant="secondary" disabled={submitting} onClick={() => onOpenChange(false)}>
                  暂以游客身份浏览
                </Button>
                <Button
                  type="button"
                  disabled={!agreed || !allAnswered || submitting}
                  onClick={() => void submitQuiz()}
                >
                  {submitting ? "提交中…" : "提交并启用账号"}
                </Button>
              </div>
            </>
          ) : (
            <div className="policy-dialog-buttons">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
