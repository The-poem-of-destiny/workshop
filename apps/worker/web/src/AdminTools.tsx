import { useEffect, useState } from "react";
import {
  api,
  type AdminAuditEvent,
  type AdminMember,
  type JsonValue,
  type ReferenceSet,
  type SiteBanner,
  type SiteSettings,
} from "./api";

type Role = "member" | "reviewer" | "owner";

const EMPTY_BANNER: SiteBanner = {
  imageUrl: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

export function AdminTools({ onError, onNotice }: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [sets, setSets] = useState<ReferenceSet[]>([]);
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [banner, setBanner] = useState<SiteBanner>(EMPTY_BANNER);
  const [siteText, setSiteText] = useState("{}");
  const [setId, setSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [setVersion, setSetVersion] = useState("");
  const [setItems, setSetItems] = useState("[]");
  const [projectId, setProjectId] = useState("");
  const [comment, setComment] = useState("");
  const [reaction, setReaction] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [memberList, auditList, referenceList, siteValue] = await Promise.all([
        api.adminMembers(),
        api.auditEvents(),
        api.referenceSets(),
        api.site(),
      ]);
      setMembers(memberList.items);
      setAudit(auditList.items);
      setSets(referenceList.items);
      setSite(siteValue);
      setBanner(siteValue.banner ?? EMPTY_BANNER);
      setSiteText(JSON.stringify(siteValue.siteContent ?? {}, null, 2));
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  function selectSet(id: string): void {
    const set = sets.find(item => item.id === id);
    if (!set) return;
    const version = set.versions[0];
    setSetId(id);
    setSetName(set.name);
    setSetDescription(set.description ?? "");
    setSetVersion(version?.label ?? "");
    setSetItems(JSON.stringify(version?.items?.map(item => ({
      kind: item.kind,
      displayName: item.displayName,
      exactHash: item.exactHash,
      normalizedContentHash: item.normalizedContentHash,
      nameHash: item.nameHash,
      structureHash: item.structureHash,
    })) ?? [], null, 2));
  }

  async function saveSite(): Promise<void> {
    try {
      const updated = await api.updateSite({ banner, siteContent: parseJson(siteText) });
      setSite(updated);
      onNotice("站点设置已保存。");
    } catch (value) {
      onError(`站点设置保存失败：${String(value)}`);
    }
  }

  async function saveRole(member: AdminMember, role: Role): Promise<void> {
    try {
      await api.adminSetRole(member.id, role);
      setMembers(previous => previous.map(item => item.id === member.id ? { ...item, role } : item));
      onNotice(`已更新 ${member.globalName || member.username} 的角色。`);
    } catch (value) {
      onError(String(value));
    }
  }

  async function saveSet(): Promise<void> {
    if (!setId) return;
    try {
      const parsedItems: unknown = parseJson(setItems);
      if (!Array.isArray(parsedItems)) throw new Error("items 必须是 JSON 数组");
      await api.updateReferenceSet(setId, {
        name: setName,
        description: setDescription || null,
        versionLabel: setVersion,
        items: parsedItems,
      });
      onNotice("基线已保存。");
      await refresh();
    } catch (value) {
      onError(`基线保存失败：${String(value)}`);
    }
  }

  async function saveRecommendation(): Promise<void> {
    if (!projectId.trim()) return;
    try {
      await api.updateRecommendation(projectId.trim(), { comment, reaction });
      onNotice("精选已保存。");
    } catch (value) {
      onError(String(value));
    }
  }

  async function removeRecommendation(): Promise<void> {
    if (!projectId.trim()) return;
    try {
      await api.deleteRecommendation(projectId.trim());
      onNotice("精选已删除。");
    } catch (value) {
      onError(String(value));
    }
  }

  return <div className="workspace admin-tools">
    <section className="panel">
      <div className="panel-heading"><h2>站点设置</h2><button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      {site ? <p className="hint">Banner 与站点文案写入 `site_settings`，保存即生效。</p> : null}
      <h3>Banner</h3>
      <div className="form-grid">
        <label>图片地址<input value={banner.imageUrl ?? ""} onChange={event => setBanner({ ...banner, imageUrl: event.target.value || null })} /></label>
        <label>缩放<input type="number" min="1" max="3" step="0.1" value={banner.zoom} onChange={event => setBanner({ ...banner, zoom: Number(event.target.value) })} /></label>
        <label>桌面 X<input type="number" min="0" max="100" value={banner.positionX} onChange={event => setBanner({ ...banner, positionX: Number(event.target.value) })} /></label>
        <label>桌面 Y<input type="number" min="0" max="100" value={banner.positionY} onChange={event => setBanner({ ...banner, positionY: Number(event.target.value) })} /></label>
        <label>手机 X<input type="number" min="0" max="100" value={banner.mobilePositionX} onChange={event => setBanner({ ...banner, mobilePositionX: Number(event.target.value) })} /></label>
        <label>手机 Y<input type="number" min="0" max="100" value={banner.mobilePositionY} onChange={event => setBanner({ ...banner, mobilePositionY: Number(event.target.value) })} /></label>
        <label>手机缩放<input type="number" min="1" max="3" step="0.1" value={banner.mobileZoom} onChange={event => setBanner({ ...banner, mobileZoom: Number(event.target.value) })} /></label>
      </div>
      <label>站点内容 JSON<textarea value={siteText} onChange={event => setSiteText(event.target.value)} rows={8} /></label>
      <button type="button" className="primary" onClick={() => void saveSite()}>保存站点设置</button>
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>成员</h2><span className="hint">{members.length} 人</span></div>
      <div className="project-list">{members.map(member => <div className="member-row" key={member.id}>
        <span><strong>{member.globalName || member.username}</strong><small>{member.id}</small></span>
        <select value={member.role} onChange={event => void saveRole(member, event.target.value as Role)}>
          <option value="member">member</option>
          <option value="reviewer">reviewer</option>
          <option value="owner">owner</option>
        </select>
      </div>)}</div>
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>编辑精选</h2></div>
      <label>项目 ID<input value={projectId} onChange={event => setProjectId(event.target.value)} /></label>
      <div className="form-grid">
        <label>评语<input value={comment} onChange={event => setComment(event.target.value)} /></label>
        <label>反应<input value={reaction} onChange={event => setReaction(event.target.value)} /></label>
      </div>
      <div className="button-row"><button type="button" className="primary" onClick={() => void saveRecommendation()}>保存精选</button><button type="button" onClick={() => void removeRecommendation()}>删除</button></div>
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>角色基线</h2><button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      <label>参考集<select value={setId} onChange={event => selectSet(event.target.value)}><option value="">选择参考集</option>{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
      {setId ? <>
        <div className="form-grid">
          <label>名称<input value={setName} onChange={event => setSetName(event.target.value)} /></label>
          <label>版本标签<input value={setVersion} onChange={event => setSetVersion(event.target.value)} /></label>
        </div>
        <label>说明<textarea value={setDescription} onChange={event => setSetDescription(event.target.value)} /></label>
        <label>items JSON<textarea value={setItems} onChange={event => setSetItems(event.target.value)} rows={10} /></label>
        <button type="button" className="primary" onClick={() => void saveSet()}>保存基线</button>
      </> : <p className="hint">选择参考集后编辑名称、版本和 items；items 全量替换。</p>}
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>审计</h2><button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      <div className="audit-list">{audit.length === 0 ? <p className="hint">暂无审计事件。</p> : audit.map(event => <div key={event.id}><strong>{event.action}</strong><small>{event.actorName ?? event.actorId ?? "system"} · {event.targetType}:{event.targetId ?? "-"} · {event.createdAt}</small><pre>{JSON.stringify(event.detail, null, 2)}</pre></div>)}</div>
    </section>
  </div>;
}
