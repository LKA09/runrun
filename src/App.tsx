import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Flame,
  Footprints,
  Heart,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { api, pace, today } from "./api";
import type { Run, User, Stats } from "./api";
import Modal from "./Modal";
const Composer = lazy(() => import("./Composer"));
const initialStats: Stats = {
  community: { runs: 0, distance: 0, runners: 0 },
  leaders: [],
  personal: { runs: 0, distance: 0, duration: 0 },
  days: [],
};
type View = "feed" | "mine" | "ranking";
function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      //
    </span>
  );
}
function fmt(n: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(n);
}
function RunCard({
  run,
  user,
  login,
  refresh,
  toast,
}: {
  run: Run;
  user: User | null;
  login: () => void;
  refresh: () => void;
  toast: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false),
    [likes, setLikes] = useState(run.likes),
    [liked, setLiked] = useState(run.liked);
  async function cheer() {
    if (!user) {
      login();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ liked: boolean; likes: number }>(
        `/posts/${run.id}/like`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked: !liked }),
        },
      );
      setLikes(r.likes);
      setLiked(r.liked);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/posts/${run.id}`, { method: "DELETE" });
      setDeleting(false);
      refresh();
      toast("인증 기록을 삭제했어요.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="run-card">
      <div className="run-image">
        <img
          src={run.photoUrl}
          alt={`${run.author}님의 러닝 인증 사진`}
          loading="lazy"
        />
        <span className="image-tag">
          <Check size={12} /> RUN COMPLETED
        </span>
        <div className="image-distance">
          {fmt(run.distance)}
          <span>km</span>
        </div>
      </div>
      <div className="run-content">
        <div className="run-author">
          <span className="avatar">{run.author.slice(0, 1)}</span>
          <div>
            <strong>{run.author}</strong>
            <small>{run.runDate.replaceAll("-", ". ")}</small>
          </div>
          {user?.id === run.userId ? (
            <button
              className="icon-button delete"
              onClick={() => setDeleting(true)}
              aria-label="내 인증 삭제"
            >
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
        {run.caption ? <p className="caption">{run.caption}</p> : null}
        <div className="run-metrics">
          <span>
            <Timer size={14} />
            {run.duration}분
          </span>
          <span>
            {pace(run.distance, run.duration)} <small>/km</small>
          </span>
        </div>
        <button
          className={`cheer ${liked ? "liked" : ""}`}
          aria-pressed={liked}
          disabled={busy}
          onClick={() => void cheer()}
        >
          <Heart size={18} fill={liked ? "currentColor" : "none"} />
          <span>{likes ? `${likes}명이 응원해요` : "첫 응원을 보내세요"}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title="이 인증을 삭제할까요?"
          close={() => {
            if (!busy) setDeleting(false);
          }}
        >
          <p className="muted">
            사진과 기록이 함께 삭제되며 되돌릴 수 없습니다.
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleting(false)}
              disabled={busy}
            >
              취소
            </button>
            <button
              className="button danger"
              onClick={() => void remove()}
              disabled={busy}
            >
              {busy ? "삭제 중…" : "삭제하기"}
            </button>
          </div>
        </Modal>
      ) : null}
    </article>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [view, setView] = useState<View>("feed"),
    [runs, setRuns] = useState<Run[]>([]),
    [stats, setStats] = useState(initialStats),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [loginOpen, setLoginOpen] = useState(false),
    [compose, setCompose] = useState(false),
    [loginBusy, setLoginBusy] = useState(false),
    [loginError, setLoginError] = useState(""),
    [notice, setNotice] = useState(""),
    [info, setInfo] = useState<"privacy" | "about" | null>(null),
    [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const toast = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: User | null }>("/me", { signal: controller.signal })
      .then((r) => setUser(r.user))
      .catch(() => {});
    return () => controller.abort();
  }, [version]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api<{ posts: Run[]; cursor: string | null }>(
        `/posts?mine=${view === "mine"}`,
        { signal: controller.signal },
      ),
      api<Stats>("/stats", { signal: controller.signal }),
    ])
      .then(([feed, summary]) => {
        setRuns(feed.posts);
        setCursor(feed.cursor);
        setStats(summary);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view, version]);
  function navigate(next: View) {
    if (next === "mine" && !user) {
      setLoginOpen(true);
      return;
    }
    setView(next);
    document
      .getElementById("activity")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function write() {
    if (!user) setLoginOpen(true);
    else setCompose(true);
  }
  async function signIn() {
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await api<{ url?: string }>("/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: window.location.origin + window.location.pathname,
          errorCallbackURL:
            window.location.origin + window.location.pathname + "?login=error",
        }),
      });
      if (!result.url) throw new Error("로그인 주소를 받지 못했어요.");
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com")
        throw new Error("로그인 주소를 확인하지 못했어요.");
      window.location.assign(url.href);
    } catch (e) {
      setLoginError((e as Error).message);
      setLoginBusy(false);
    }
  }
  async function signOut() {
    try {
      await api("/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setUser(null);
      setView("feed");
      refresh();
      toast("로그아웃했어요.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const result = await api<{ posts: Run[]; cursor: string | null }>(
        `/posts?mine=${view === "mine"}&cursor=${encodeURIComponent(cursor)}`,
      );
      setRuns((prev) => [
        ...prev,
        ...result.posts.filter((p) => !prev.some((r) => r.id === p.id)),
      ]);
      setCursor(result.cursor);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${today()}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 6 + i);
    return {
      date: date.toISOString().slice(0, 10),
      label: ["일", "월", "화", "수", "목", "금", "토"][date.getUTCDay()],
    };
  });
  return (
    <>
      <a className="skip-link" href="#activity">
        러닝 피드로 건너뛰기
      </a>
      <div className="topline">EVERY PACE. EVERY PERSON. EVERY RUN.</div>
      <header className="header">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <Mark />
          RUNRUN<span>RUNNING CLUB</span>
        </a>
        <nav aria-label="주 메뉴">
          <button
            className={view === "feed" ? "active" : ""}
            onClick={() => navigate("feed")}
          >
            러닝 피드
          </button>
          <button
            className={view === "mine" ? "active" : ""}
            onClick={() => navigate("mine")}
          >
            나의 러닝
          </button>
          <button
            className={view === "ranking" ? "active" : ""}
            onClick={() => navigate("ranking")}
          >
            러너 랭킹
            <span className="nav-dot" />
          </button>
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <button className="profile" onClick={() => navigate("mine")}>
                <span className="avatar small">{user.name.slice(0, 1)}</span>
                <span>{user.name}</span>
              </button>
              <button
                className="icon-button"
                aria-label="로그아웃"
                onClick={() => void signOut()}
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button className="login-button" onClick={() => setLoginOpen(true)}>
              <UserRound size={17} /> 로그인
            </button>
          )}
          <button className="button black header-write" onClick={write}>
            <Plus size={17} />
            러닝 인증
          </button>
        </div>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <img
            className="hero-photo"
            src={`${import.meta.env.BASE_URL}runner.jpg`}
            alt="아침 햇살 아래 도로를 달리는 러너"
            fetchPriority="high"
          />
          <div className="hero-shade" />
          <div className="hero-copy">
            <span className="eyebrow light">
              <span className="live-dot" /> JUST GET OUT & RUN
            </span>
            <h1 id="hero-title">
              EVERY RUN
              <br />
              <em>COUNTS.</em>
              <span className="hero-star">✳</span>
            </h1>
            <p>
              빠르지 않아도, 멀리 가지 않아도.
              <br />
              오늘 달린 당신의 이야기를 들려주세요.
            </p>
            <button className="button primary" onClick={write}>
              오늘의 러닝 인증하기
              <ArrowUpRight size={20} />
            </button>
          </div>
          <div className="hero-side">
            <span>
              YOUR PACE.
              <br />
              YOUR STORY.
            </span>
            <span>
              37° N / 127° E<br />
              MADE FOR EVERY RUNNER
            </span>
          </div>
          <div className="hero-bottom">
            <span>
              <span className="live-dot" /> WE RUN TOGETHER
            </span>
            <a href="#activity">
              SCROLL TO EXPLORE
              <ArrowDown size={14} />
            </a>
          </div>
          <span className="hero-stamp">
            RUN
            <br />
            <b>CLUB</b>
            <i>EST. 2026</i>
          </span>
        </section>
        <div className="manifesto">
          <span>NO RUN TOO SMALL.</span>
          <span className="manifesto-star">✳</span>
          <span>NO PACE TOO SLOW.</span>
          <span className="manifesto-star">✳</span>
          <span>JUST SHOW UP.</span>
          <ArrowUpRight size={30} />
        </div>
        <div className="main-grid">
          <div className="main-content">
            <section
              className="community-strip"
              aria-label="이번 달 커뮤니티 기록"
            >
              <div>
                <span className="eyebrow">THIS MONTH, TOGETHER</span>
                <p>한 걸음씩, 함께 쌓이는 기록.</p>
              </div>
              <div className="community-number">
                <strong>
                  {fmt(stats.community.distance)}
                  <small>km</small>
                </strong>
                <span>함께 달린 거리</span>
              </div>
              <div className="community-number">
                <strong>
                  {fmt(stats.community.runs)}
                  <small>runs</small>
                </strong>
                <span>완료한 러닝</span>
              </div>
              <div className="community-number">
                <strong>
                  {fmt(stats.community.runners)}
                  <small>runners</small>
                </strong>
                <span>함께한 러너</span>
              </div>
            </section>
            <section id="activity" className="activity">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {view === "ranking"
                      ? "THE WEEKLY LINEUP"
                      : view === "mine"
                        ? "YOUR RUNNING JOURNAL"
                        : "THE RUNNING COMMUNITY"}
                  </span>
                  <h2>
                    {view === "ranking"
                      ? "함께 달리는 러너들"
                      : view === "mine"
                        ? "나의 러닝 기록"
                        : "오늘도, 달렸습니다."}
                    <span className="lime-dot" />
                  </h2>
                </div>
                <button
                  className="icon-button refresh"
                  onClick={refresh}
                  aria-label="피드 새로고침"
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              <div className="feed-toolbar">
                <div
                  className="filter-tabs"
                  role="group"
                  aria-label="피드 보기"
                >
                  <button
                    className={view === "feed" ? "selected" : ""}
                    onClick={() => navigate("feed")}
                  >
                    <LayoutGrid size={15} />
                    전체 러닝
                  </button>
                  <button
                    className={view === "mine" ? "selected" : ""}
                    onClick={() => navigate("mine")}
                  >
                    <Footprints size={15} />
                    나의 러닝
                  </button>
                </div>
                <span className="sort-label">
                  {view === "ranking" ? "최근 7일 거리순" : "최신순"}
                  <span>↓</span>
                </span>
              </div>
              {view === "ranking" ? (
                <div className="ranking-panel">
                  <div className="ranking-intro">
                    <Trophy size={34} />
                    <h3>같은 길, 각자의 페이스.</h3>
                    <p>최근 7일 동안 인증한 거리를 함께 나눠요.</p>
                  </div>
                  {stats.leaders.length ? (
                    stats.leaders.map((r, i) => (
                      <div className="leader-row large" key={i}>
                        <span className="rank">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="avatar">{r.name.slice(0, 1)}</span>
                        <div>
                          <strong>{r.name}</strong>
                          <small>{r.runs}회 러닝 인증</small>
                        </div>
                        <b>
                          {fmt(r.distance)} <small>km</small>
                        </b>
                      </div>
                    ))
                  ) : (
                    <p className="ranking-empty">
                      첫 인증을 남기고 이번 주 러너가 되어보세요.
                    </p>
                  )}
                </div>
              ) : error ? (
                <div className="empty-state error-state">
                  <RefreshCw size={30} />
                  <h3>피드를 불러오지 못했어요.</h3>
                  <p>{error}</p>
                  <button className="button black" onClick={refresh}>
                    다시 불러오기
                    <RefreshCw size={16} />
                  </button>
                </div>
              ) : loading && !runs.length ? (
                <div className="loading-state" role="status">
                  <LoaderCircle className="spin" size={28} />
                  <p>러너들의 이야기를 가져오는 중…</p>
                </div>
              ) : runs.length ? (
                <>
                  <div className="feed-grid">
                    {runs.map((run) => (
                      <RunCard
                        key={`${run.id}-${version}`}
                        run={run}
                        user={user}
                        login={() => setLoginOpen(true)}
                        refresh={refresh}
                        toast={toast}
                      />
                    ))}
                  </div>
                  {cursor ? (
                    <button
                      className="button secondary load-more"
                      disabled={loading}
                      onClick={() => void more()}
                    >
                      {loading ? "불러오는 중…" : "러닝 더 보기"}
                      <Plus size={16} />
                    </button>
                  ) : (
                    <div className="feed-end">
                      YOU'RE ALL CAUGHT UP. GO FOR A RUN.{" "}
                      <Footprints size={16} />
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <span className="empty-art">
                    <Footprints size={45} strokeWidth={1.25} />
                    <span>01</span>
                  </span>
                  <span className="eyebrow">IT ALL STARTS WITH ONE RUN</span>
                  <h3>
                    {view === "mine"
                      ? "당신의 첫 러닝을 기다려요."
                      : "첫 번째 러너를 기다립니다."}
                  </h3>
                  <p>
                    거창한 기록은 필요 없어요.
                    <br />
                    사진 한 장, 짧은 한마디면 충분하니까.
                  </p>
                  <button className="button black" onClick={write}>
                    첫 러닝 남기기
                    <ArrowUpRight size={17} />
                  </button>
                </div>
              )}
            </section>
            <div className="quote-block">
              <span>“</span>
              <h3>
                어제보다 빠르게 말고,
                <br />
                <em>어제보다 나답게.</em>
              </h3>
              <p>YOUR ONLY COMPETITION IS YOU.</p>
            </div>
          </div>
          <aside className="sidebar">
            <section className="your-week">
              <div className="aside-heading">
                <span className="eyebrow">MY RUNNING</span>
                <Footprints size={20} />
              </div>
              <h2>
                {user ? `${user.name}님의` : "당신의"}
                <br />
                이번 달 러닝.
              </h2>
              <div className="personal-distance">
                {fmt(stats.personal.distance)}
                <span>km</span>
              </div>
              <div className="personal-details">
                <span>
                  러닝 횟수
                  <b>
                    {stats.personal.runs}
                    <small>회</small>
                  </b>
                </span>
                <span>
                  달린 시간
                  <b>
                    {fmt(stats.personal.duration)}
                    <small>분</small>
                  </b>
                </span>
              </div>
              <div className="week-days">
                {days.map((d) => (
                  <div key={d.date}>
                    <span>{d.label}</span>
                    <i
                      className={`${stats.days.includes(d.date) ? "completed" : ""} ${d.date === today() ? "is-today" : ""}`}
                    >
                      {stats.days.includes(d.date) ? (
                        <Check size={15} />
                      ) : d.date === today() ? (
                        <span className="day-dot" />
                      ) : null}
                    </i>
                  </div>
                ))}
              </div>
              <button className="week-cta" onClick={write}>
                {user ? "오늘의 한 걸음 기록하기" : "로그인하고 기록 시작하기"}
                <ArrowUpRight size={18} />
              </button>
            </section>
            <section className="weekly-leaders">
              <div className="aside-heading">
                <h3>
                  <Flame size={19} /> 이번 주 러너
                </h3>
                <span>TOP 5</span>
              </div>
              {stats.leaders.length ? (
                stats.leaders.map((r, i) => (
                  <div className="leader-row" key={i}>
                    <span className="rank">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="avatar small">{r.name.slice(0, 1)}</span>
                    <strong>{r.name}</strong>
                    <b>
                      {fmt(r.distance)}
                      <small> km</small>
                    </b>
                  </div>
                ))
              ) : (
                <div className="leader-empty">
                  <Trophy size={27} strokeWidth={1.2} />
                  <p>
                    이번 주의 주인공은
                    <br />
                    바로 당신일지도.
                  </p>
                </div>
              )}
              <button className="text-link" onClick={() => navigate("ranking")}>
                러너 랭킹 보기
                <ChevronRight size={15} />
              </button>
            </section>
            <section className="run-note">
              <span className="note-number">RUN NOTE / 001</span>
              <span className="note-spark">✳</span>
              <h3>
                시작하기에
                <br />
                완벽한 날은
                <br />
                <em>오늘.</em>
              </h3>
              <p>
                운동화 끈을 묶는 순간,
                <br />
                이미 절반은 해낸 거예요.
              </p>
              <span className="note-footer">
                LESS THINKING. MORE RUNNING.
                <ArrowUpRight size={18} />
              </span>
            </section>
            <p className="community-rule">
              <ShieldCheck size={15} />
              서로의 페이스를 존중해주세요.
              <br />
              여기는 모든 러너를 위한 공간입니다.
            </p>
          </aside>
        </div>
      </main>
      <footer>
        <a className="brand" href={import.meta.env.BASE_URL}>
          <Mark />
          RUNRUN
        </a>
        <span>EVERY RUN IS A GOOD RUN.</span>
        <div>
          <button onClick={() => setInfo("about")}>커뮤니티 소개</button>
          <button onClick={() => setInfo("privacy")}>개인정보 안내</button>
          <small>© {new Date().getFullYear()} RUNRUN</small>
        </div>
      </footer>
      <button
        className="mobile-write"
        onClick={write}
        aria-label="러닝 인증 올리기"
      >
        <Plus size={25} />
      </button>
      {notice ? (
        <div className="toast" role="status">
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      ) : null}
      {loginOpen ? (
        <Modal title="우리, 함께 달려요." close={() => setLoginOpen(false)}>
          <div className="login-modal">
            <span className="login-mark">
              <Mark />
            </span>
            <h3>
              YOUR NEXT RUN
              <br />
              STARTS HERE.
            </h3>
            <p>
              Google 계정으로 시작하고
              <br />
              당신만의 러닝 이야기를 남겨보세요.
            </p>
            <button
              className="google-button"
              onClick={() => void signIn()}
              disabled={loginBusy}
            >
              <span className="google-g">G</span>
              {loginBusy ? "Google에 연결 중…" : "Google로 계속하기"}
              <ArrowRight size={18} />
            </button>
            {loginError ? (
              <p className="form-error" role="alert">
                {loginError}
              </p>
            ) : null}
            <small>
              이름과 이메일을 로그인에 사용하며,
              <br />
              이메일은 다른 러너에게 공개하지 않습니다.
            </small>
            <button
              className="text-link"
              onClick={() => {
                setLoginOpen(false);
                setInfo("privacy");
              }}
            >
              개인정보 안내
              <ChevronRight size={14} />
            </button>
          </div>
        </Modal>
      ) : null}
      {compose ? (
        <Suspense
          fallback={
            <div className="toast" role="status">
              인증 화면을 준비하고 있어요…
            </div>
          }
        >
          <Composer
            close={() => setCompose(false)}
            done={() => {
              setCompose(false);
              setView("feed");
              refresh();
              toast("오늘도 해냈네요. 러닝 인증을 올렸어요!");
            }}
          />
        </Suspense>
      ) : null}
      {info ? (
        <Modal
          title={
            info === "privacy" ? "개인정보 안내" : "모든 페이스를 위한 RUNRUN"
          }
          close={() => setInfo(null)}
        >
          <div className="info-copy">
            {info === "privacy" ? (
              <>
                <p>
                  Google 로그인에서 이름, 이메일, 계정 식별자를 받아 로그인과
                  인증 기록 관리에 사용합니다. 비밀번호는 받지 않습니다.
                </p>
                <p>
                  이름, 사진, 글, 거리와 시간은 공개됩니다. 이메일과 로그인
                  세션은 공개하지 않습니다. 업로드한 사진은 다시 인코딩해 EXIF
                  위치 정보를 제거합니다.
                </p>
                <p>
                  로그인 세션은 HttpOnly 쿠키로 보관합니다. 게시물은 작성자가
                  직접 삭제할 수 있습니다. 계정 삭제 요청:{" "}
                  <a
                    href="https://github.com/LKA09/runrun/issues"
                    target="_blank"
                    rel="noreferrer"
                  >
                    운영 저장소
                  </a>
                  에서 개인정보를 적지 않고 문의해주세요.
                </p>
              </>
            ) : (
              <>
                <p>
                  RUNRUN은 사진 한 장과 짧은 글로 러닝의 순간을 나누는
                  공간입니다. 빠른 기록보다 꾸준한 한 걸음을 응원합니다.
                </p>
                <p>
                  직접 달린 기록과 본인의 사진을 올려주세요. 다른 사람의 얼굴,
                  연락처, 집 주소 등 개인정보가 공개되지 않도록 확인해주세요.
                </p>
                <p>
                  RUNRUN은 독립적인 러닝 커뮤니티이며 Nike와 제휴 관계가
                  없습니다.
                </p>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
