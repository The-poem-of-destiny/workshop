import { useEffect, useState } from "react";
import { api, type HomeResponse, type ProjectSummary } from "./api";

const SORTS = [
  ["updated", "最近更新"],
  ["published", "发布时间"],
  ["downloads", "下载"],
  ["likes", "点赞"],
] as const;

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: (p: ProjectSummary) => void }) {
  return (
    <button className="card" type="button" onClick={() => onOpen(project)}>
      <div className="cover">
        {project.coverUrl ? <img src={project.coverUrl} alt="" loading="lazy" /> : <span>无封面</span>}
      </div>
      <div className="card-body">
        <h3>{project.title}</h3>
        <p className="author">{project.author.name}</p>
        <p className="meta">
          世界书 {project.entries.worldbook} 条 | 正则 {project.entries.regex} 条
        </p>
        <div className="tags">
          {project.projectType ? <span>{project.projectType}</span> : null}
          {project.schemaVersion ? <span>适配 {project.schemaVersion}</span> : null}
          {project.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}
        </div>
      </div>
    </button>
  );
}

function Detail({ project, onClose }: { project: ProjectSummary; onClose: () => void }) {
  return (
    <aside className="detail">
      <button className="close" type="button" onClick={onClose}>关闭</button>
      <h2>{project.title}</h2>
      <p className="author">{project.author.name}</p>
      <p>{project.description}</p>
      <dl>
        <div><dt>世界书</dt><dd>{project.entries.worldbook} 条</dd></div>
        <div><dt>正则</dt><dd>{project.entries.regex} 条</dd></div>
        <div><dt>下载</dt><dd>{project.counts.downloads}</dd></div>
        <div><dt>点赞</dt><dd>{project.counts.likes}</dd></div>
      </dl>
      <p className="hint">安装需要登录；登录流程尚未接入此页面。</p>
    </aside>
  );
}

export function App() {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("updated");
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.home().then(setHome).catch(error => setError(String(error)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.projects({ search: search.trim() || undefined, sort })
        .then(result => {
          if (!cancelled) setProjects(result.items);
        })
        .catch(error => {
          if (!cancelled) setError(String(error));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, sort]);

  return (
    <div className="shell">
      <header>
        <div>
          <p className="eyebrow">命定之诗与黄昏之歌</p>
          <h1>创意工坊</h1>
        </div>
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="搜索项目、作者、标签"
          aria-label="搜索"
        />
      </header>

      {home?.banner?.imageUrl ? (
        <div className="banner" style={{ backgroundImage: `url(${home.banner.imageUrl})` }} />
      ) : null}

      <nav className="sorts" aria-label="排序">
        {SORTS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={sort === value ? "active" : ""}
            onClick={() => setSort(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="error">{error}</p> : null}

      <main className="grid">
        {projects.map(project => (
          <ProjectCard key={project.id} project={project} onOpen={setSelected} />
        ))}
      </main>

      {selected ? <Detail project={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
