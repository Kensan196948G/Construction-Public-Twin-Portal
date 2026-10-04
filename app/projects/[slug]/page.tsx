import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { impactsForProject } from "@/lib/data/impacts";
import { getProjectBySlug, publicProjects } from "@/lib/data/projects";
import {
  PROJECT_STATUS_LABEL,
  type ProjectStatus,
} from "@/lib/schemas/project";
import { IMPACT_SEVERITY_LABEL, IMPACT_TYPE_LABEL } from "@/lib/schemas/impact";
import styles from "./page.module.css";

/** 画面ファイル第一（screen-file-first）方針: 工事詳細を独立したルートとして提供する。 */

export function generateStaticParams() {
  return publicProjects().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) return { title: "工事が見つかりません | 工事みえるマップ 3D Beta" };
  return {
    title: `${project.publicTitle} | 工事みえるマップ 3D Beta`,
    description: project.purpose.slice(0, 120),
  };
}

const STATUS_CLASS: Record<ProjectStatus, string> = {
  planned: "planned",
  under_construction: "active",
  completed: "done",
  suspended: "cat",
};

const SEVERITY_CLASS = {
  info: "info",
  notice: "notice",
  warning: "warning",
} as const;

const SEVERITY_COLOR = {
  info: "var(--st-detour)",
  notice: "var(--st-active)",
  warning: "var(--st-reg)",
} as const;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) notFound();

  const impacts = impactsForProject(project.id);
  const statusClass = STATUS_CLASS[project.status];

  return (
    <main
      className={styles.page}
      style={{ ["--status" as string]: `var(--st-${statusClass === "active" ? "active" : statusClass === "planned" ? "planned" : statusClass === "done" ? "done" : "hold"})` }}
    >
      <div className={styles.shell}>
        <div className={styles.backRow}>
          <Link className={styles.back} href="/">
            ← 地図に戻る
          </Link>
          <span className={styles.crumb}>
            工事みえるマップ 3D Beta / 工事詳細 / {project.slug}
          </span>
        </div>

        <article className={styles.card}>
          <header className={styles.hero}>
            <div className={styles.tags}>
              <span className={`pill ${statusClass} solid`}>{PROJECT_STATUS_LABEL[project.status]}</span>
              <span className="pill cat">{project.category}</span>
              <span className="pill cat">{project.location.municipality}</span>
            </div>
            <h1 className={styles.title}>{project.publicTitle}</h1>
            <p className={styles.formal}>正式名称: {project.name}</p>
          </header>

          <figure className={styles.photo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={project.visual.thumbnailUrl}
              alt={`${project.publicTitle}の参考写真`}
              width={1200}
              height={750}
            />
            {project.visual.thumbnailCredit && (
              <figcaption>
                写真: {project.visual.thumbnailCredit.author}（
                {project.visual.thumbnailCredit.license}） /{" "}
                <a
                  href={project.visual.thumbnailCredit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Wikimedia Commons
                </a>
                （サンプル画像。この工事の現場写真ではありません）
              </figcaption>
            )}
          </figure>

          <div className={styles.grid}>
            <div>
              <p className={styles.k}>発注者</p>
              <p className={styles.v}>{project.owner.name}</p>
            </div>
            <div>
              <p className={styles.k}>施工者</p>
              <p className={styles.v}>{project.contractor.name}</p>
            </div>
            <div>
              <p className={styles.k}>工期</p>
              <p className={styles.v}>
                <span className="num">{project.schedule.startDate}</span> 〜{" "}
                <span className="num">{project.schedule.plannedEndDate}</span>
              </p>
            </div>
            <div>
              <p className={styles.k}>現在工程</p>
              <p className={styles.v}>{project.schedule.phase}</p>
            </div>
            <div>
              <p className={styles.k}>所在地</p>
              <p className={styles.v}>
                {project.location.postalCode ? `〒${project.location.postalCode} ` : ""}
                {project.location.address}
              </p>
            </div>
            <div>
              <p className={styles.k}>最終更新日時</p>
              <p className={styles.v}>
                <span className="num">{formatDateTime(project.schedule.lastUpdatedAt)}</span>
              </p>
            </div>
          </div>

          <section className={styles.sec}>
            <h2>工事目的</h2>
            <p>{project.purpose}</p>
          </section>

          <section className={styles.sec}>
            <h2>整備効果</h2>
            <ul className={styles.benefits}>
              {project.benefits.map((b) => (
                <li key={b}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.sec}>
            <h2>交通規制・周辺への影響（{impacts.length}件）</h2>
            {impacts.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
                現在、交通規制の情報はありません。
              </p>
            ) : (
              <ul className={styles.impacts}>
                {impacts.map((impact) => (
                  <li
                    key={impact.id}
                    style={{ ["--sev" as string]: SEVERITY_COLOR[impact.severity] }}
                  >
                    <div className={styles.impTop}>
                      <span className={styles.impTitle}>{impact.title}</span>
                      <span className={`sev-pill ${SEVERITY_CLASS[impact.severity]}`}>
                        {IMPACT_SEVERITY_LABEL[impact.severity]}
                      </span>
                    </div>
                    <p className={styles.impDesc}>
                      【{IMPACT_TYPE_LABEL[impact.type]}】{impact.description}
                    </p>
                    <p className={styles.impPeriod}>
                      {impact.activeFrom} 〜 {impact.activeTo} / {impact.recurrence}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.sec}>
            <h2>情報源</h2>
            <div className={styles.source}>
              <span>
                情報提供元: <strong>{project.source.provider}</strong>
                {project.source.dataset ? `（${project.source.dataset}）` : ""}
              </span>
              <a href={project.source.officialUrl} target="_blank" rel="noopener noreferrer">
                公式情報を見る ↗
              </a>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              確認日時: <span className="num">{formatDateTime(project.source.verifiedAt)}</span>
            </p>
          </section>

          <section className={styles.sec}>
            <p className={styles.disclaimer}>{project.disclaimer}</p>
          </section>
        </article>
      </div>
    </main>
  );
}
