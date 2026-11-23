import { ArrowLeft, FolderOpen, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { type AuthorProfileResponse, api, type CollectionSummary } from "../../api";

export function CollectionAuthorBanner({
  author,
  collection,
  total,
  onSelectAuthor,
  onSelectCollection,
  onClearScope,
}: {
  author: { id: string; name: string } | null;
  collection: { id: string; title: string } | null;
  total: number;
  onSelectAuthor: (author: { id: string; name: string }) => void;
  onSelectCollection: (collection: { id: string; title: string }) => void;
  onClearScope: () => void;
}) {
  const [authorProfile, setAuthorProfile] = useState<AuthorProfileResponse | null>(null);
  const [collectionDetail, setCollectionDetail] = useState<CollectionSummary | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  const authorId = author?.id ?? null;
  const collectionId = collection?.id ?? null;

  useEffect(() => {
    setAuthorProfile(null);
    setFailedAvatar(null);
    if (!authorId) return;
    let active = true;
    api
      .authorProfile(authorId)
      .then((profile) => {
        if (active) setAuthorProfile(profile);
      })
      .catch(() => {
        if (active) setAuthorProfile(null);
      });
    return () => {
      active = false;
    };
  }, [authorId]);

  useEffect(() => {
    setCollectionDetail(null);
    if (!collectionId) return;
    let active = true;
    api
      .collection(collectionId)
      .then((detail) => {
        if (active) setCollectionDetail(detail);
      })
      .catch(() => {
        if (active) setCollectionDetail(null);
      });
    return () => {
      active = false;
    };
  }, [collectionId]);

  if (collection) {
    const activeDetail = collectionDetail?.id === collection.id ? collectionDetail : null;
    const title = activeDetail?.title ?? collection.title;
    const owner = activeDetail?.author ?? null;
    return (
      <section className="showcase-banner showcase-collection" aria-label="作品合集展示">
        <div className="showcase-banner-top">
          <div className="showcase-identity">
            <span className="showcase-icon" aria-hidden="true">
              <FolderOpen />
            </span>
            <div>
              <p className="showcase-kicker">作品合集</p>
              <h2>{title}</h2>
              {activeDetail?.description ? <p className="showcase-desc">{activeDetail.description}</p> : null}
              <div className="showcase-meta">
                {owner ? (
                  <button type="button" className="showcase-author-link" onClick={() => onSelectAuthor(owner)}>
                    作者：{owner.name}（查看作者全部作品）
                  </button>
                ) : null}
                <span>合集公开作品 {activeDetail?.projectCount ?? total} 个 · 可继续使用左侧分类与标签筛选</span>
              </div>
            </div>
          </div>
          <button type="button" className="showcase-back" onClick={onClearScope}>
            <ArrowLeft aria-hidden="true" />
            返回全部作品
          </button>
        </div>
      </section>
    );
  }

  if (author) {
    const activeProfile = authorProfile?.author.id === author.id ? authorProfile : null;
    const displayAuthor = activeProfile?.author ?? { id: author.id, name: author.name, avatarUrl: null };
    const collections = activeProfile?.collections ?? [];
    return (
      <section className="showcase-banner showcase-author" aria-label="作者作品展示">
        <div className="showcase-banner-top">
          <div className="showcase-identity">
            <span className="showcase-avatar" aria-hidden="true">
              {displayAuthor.avatarUrl && displayAuthor.avatarUrl !== failedAvatar ? (
                <img src={displayAuthor.avatarUrl} alt="" onError={() => setFailedAvatar(displayAuthor.avatarUrl)} />
              ) : (
                <UserRound />
              )}
            </span>
            <div>
              <p className="showcase-kicker">创作者作品集</p>
              <h2>{displayAuthor.name}</h2>
              <div className="showcase-meta">
                <span>共 {activeProfile?.projectCount ?? total} 个公开发布作品</span>
                <span>可叠加使用分类、标签与搜索筛选该作者的作品</span>
              </div>
            </div>
          </div>
          <button type="button" className="showcase-back" onClick={onClearScope}>
            <ArrowLeft aria-hidden="true" />
            返回全部作品
          </button>
        </div>
        {collections.length > 0 ? (
          <div className="showcase-collections-strip">
            <span className="showcase-strip-label">作者的系列合集：</span>
            <div className="showcase-strip-items">
              {collections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="showcase-collection-pill"
                  onClick={() => onSelectCollection({ id: item.id, title: item.title })}
                >
                  <FolderOpen aria-hidden="true" />
                  <span>{item.title}</span>
                  <small>{item.projectCount}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return null;
}
