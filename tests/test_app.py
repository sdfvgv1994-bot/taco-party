"""taco 派對兔的檢查：App 檔案齊全、沒有殘留舊版 Python 伺服器的路徑、core/yt-core.js 的規則（用 node 跑）。"""
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_FILES = sorted([ROOT / "app.js", ROOT / "sw.js", *(ROOT / "core").glob("*.js"), *(ROOT / "blocks").glob("*.js")])


def run_node(script):
    """用 node 跑一段 ES module 程式，回傳它印出來的 JSON。"""
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(out.stdout)


def test_app_files():
    """可以裝到手機桌面：manifest、圖示、service worker 都在；部署流程會填版本號。"""
    m = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert m["scope"] == "./" and m["start_url"] == "./" and m["display"] == "standalone"
    sizes = {i["sizes"] for i in m["icons"] if i["type"] == "image/png"}
    assert {"192x192", "512x512"} <= sizes, "Android 安裝需要 192 和 512 的 PNG 圖示"
    for i in m["icons"]:
        assert (ROOT / i["src"]).is_file(), i["src"]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '<meta name="app-version" content="dev" />' in html
    assert re.findall(r'<script type="module" src="([^"]+)"', html) == ["app.js"]
    for slot in ["slot-player", "slot-importer", "slot-queue", "slot-party-room", "slot-sleep-timer", "slot-cue-points"]:
        assert f'id="{slot}"' in html, slot
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    assert re.search(r"\[hidden\][^{]*\{\s*display\s*:\s*none\s*!important", css)
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "site/index.html" in wf and "pytest" in wf


def test_no_absolute_paths_or_backend():
    """GitHub Pages 的網址是 /taco-party/ 底下：不能用 / 開頭的路徑，也不能再呼叫舊版 Python 伺服器的 /api/。"""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert not re.search(r'(?:src|href)="/(?!/)', html), "index.html 有 / 開頭的路徑"
    for f in JS_FILES:
        text = f.read_text(encoding="utf-8")
        assert not re.search(r"""from\s+['"]/""", text), f"{f.name} 用了 / 開頭的 import"
        assert "/api/" not in text, f"{f.name} 還在呼叫舊版伺服器的 /api/"
        assert not re.search(r"""['"]/(?:icon|core|blocks|sw|app|styles|manifest)""", text), f"{f.name} 有 / 開頭的檔案路徑"
    m = (ROOT / "manifest.webmanifest").read_text(encoding="utf-8")
    assert '"/' not in m


def test_service_worker_lists_real_files():
    """service worker 要先存的檔案都真的存在（少一個就打不開離線畫面）；每個前端檔案也都有存到。"""
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    listed = re.findall(r"'\./([^']*)'", sw.split("APP_SHELL = [", 1)[1].split("];", 1)[0])
    for rel in listed:
        if rel:
            assert (ROOT / rel).is_file(), rel
    for f in JS_FILES:
        rel = f.relative_to(ROOT).as_posix()
        if rel != "sw.js":
            assert rel in listed, f"sw.js 的 APP_SHELL 少了 {rel}"


def test_js_syntax():
    """所有 JS 檔案語法正確。"""
    if not shutil.which("node"):
        return
    for f in JS_FILES:
        mode = "--input-type=commonjs" if f.name == "sw.js" else "--input-type=module"
        subprocess.run(["node", mode, "--check"], input=f.read_text(encoding="utf-8"),
                       capture_output=True, text=True, check=True)


def test_parse_links():
    """解析 YouTube 連結：影片、Shorts、分享連結、Music、播放清單；自動合輯標成 mix；假網站不算。"""
    if not shutil.which("node"):
        return
    r = run_node("""
    import * as c from './core/yt-core.js';
    const P = (t) => c.parseYouTube(t);
    console.log(JSON.stringify({
      parse: [
        P('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'),
        P('https://youtu.be/dQw4w9WgXcQ?si=abc'),
        P('m.youtube.com/shorts/dQw4w9WgXcQ'),
        P('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'),
        P('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'),
        P('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'),
        P('https://evil.com/watch?v=dQw4w9WgXcQ'),
        P('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'),
        P('hello'),
        P('dQw4w9WgXcQ'),
        P('https://www.youtube.com/watch?v=short')
      ],
      all: c.parseAll('聽這首 https://youtu.be/dQw4w9WgXcQ，還有\\nhttps://www.youtube.com/watch?v=9bZkp7q19f0)\\nprogramming\\nkJQP7kiw5Fk').map((x) => x.video)
    }));
    """)
    assert r["parse"] == [
        {"video": "dQw4w9WgXcQ"},
        {"video": "dQw4w9WgXcQ"},
        {"video": "dQw4w9WgXcQ"},
        {"video": "dQw4w9WgXcQ", "list": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"},
        {"list": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"},
        {"video": "dQw4w9WgXcQ", "mix": True},
        None, None, None,
        {"video": "dQw4w9WgXcQ"},
        None,
    ]
    assert r["all"] == ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"]


def test_add_to_queue():
    """加歌不重複；空清單加歌會選第一首；插播放在正在播的下一首。"""
    if not shutil.which("node"):
        return
    r = run_node("""
    import * as c from './core/yt-core.js';
    const T = (id) => c.makeTrack(id);
    const a = c.addToQueue([], -1, [T('aaaaaaaaaaa'), T('bbbbbbbbbbb'), T('aaaaaaaaaaa'), T('bad')]);
    const b = c.addToQueue(a.queue, 0, [T('ccccccccccc'), T('bbbbbbbbbbb')], true);
    const d = c.addToQueue(b.queue, 1, [T('ddddddddddd')]);
    console.log(JSON.stringify({
      a: [a.added, a.skipped, a.currentIndex, a.queue.map((t) => t.videoId)],
      b: [b.added, b.skipped, b.currentIndex, b.queue.map((t) => t.videoId)],
      d: [d.currentIndex, d.queue.map((t) => t.videoId)],
      title: [a.queue[0].title, c.needsTitle(a.queue[0]), c.needsTitle({ ...a.queue[0], title: '歌' })],
      thumb: a.queue[0].thumbnail
    }));
    """)
    assert r["a"] == [2, 1, 0, ["aaaaaaaaaaa", "bbbbbbbbbbb"]]
    assert r["b"] == [1, 1, 0, ["aaaaaaaaaaa", "ccccccccccc", "bbbbbbbbbbb"]]
    assert r["d"] == [1, ["aaaaaaaaaaa", "ccccccccccc", "bbbbbbbbbbb", "ddddddddddd"]]
    assert r["title"] == ["YouTube 影片 (aaaaaaaaaaa)", True, False]
    assert r["thumb"] == "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"


def test_next_index_skips_bad_songs():
    """自動換歌跳過播不了的歌；全部都播不了就停（回 -1，不會無限重試）；手動上一首／下一首會繞回頭。"""
    if not shutil.which("node"):
        return
    r = run_node("""
    import * as c from './core/yt-core.js';
    const Q = (bads) => bads.map((b, i) => ({ videoId: 'v' + i, bad: b }));
    const S = (bads, cur, extra = {}) => ({ queue: Q(bads), currentIndex: cur, shuffle: false, repeatMode: 'all', ...extra });
    const N = c.nextIndex;
    const seq = (s) => { let x = 0; return () => [0.0, 0.5, 0.99][x++ % 3]; };
    console.log(JSON.stringify({
      empty: N(S([], -1), 1, true),
      fromStart: N(S([false, false], -1), 1, false),
      manualNext: N(S([false, false, false], 2), 1, false),
      manualPrev: N(S([false, false, false], 0), -1, false),
      autoWrap: N(S([false, false, false], 2), 1, true),
      skipBad: N(S([false, true, true, false], 0), 1, true),
      manualKeepsBad: N(S([false, true, false], 0), 1, false),
      allBad: N(S([true, true, true], 0), 1, true),
      allBadButCur: N(S([false, true, true], 0), 1, true),
      offStops: N(S([false, false], 1, { repeatMode: 'off' }), 1, true),
      offManualWraps: N(S([false, false], 1, { repeatMode: 'off' }), 1, false),
      oneRepeats: N(S([false, false], 0, { repeatMode: 'one' }), 1, true),
      oneManualMoves: N(S([false, false], 0, { repeatMode: 'one' }), 1, false),
      oneButBad: N(S([true, false], 0, { repeatMode: 'one' }), 1, true),
      shuffleNeverCurOrBad: [0, 1, 2, 3, 4, 5].map((k) => N(S([false, true, false, false], 0, { shuffle: true }), 1, true, () => k / 6)),
      shuffleAllBad: N(S([false, true, true], 0, { shuffle: true }), 1, true),
      reasons: [c.errorReason(150), c.errorReason(101), c.errorReason(100), c.errorReason(5)]
    }));
    """)
    assert r["empty"] == -1
    assert r["fromStart"] == 0
    assert r["manualNext"] == 0 and r["manualPrev"] == 2
    assert r["autoWrap"] == 0
    assert r["skipBad"] == 3
    assert r["manualKeepsBad"] == 1, "手動按下一首時，標成播不了的歌還是可以再試"
    assert r["allBad"] == -1, "全部都播不了要停下來"
    assert r["allBadButCur"] == 0, "只剩正在播的這首能播：循環回它自己"
    assert r["offStops"] == -1 and r["offManualWraps"] == 0
    assert r["oneRepeats"] == 0 and r["oneManualMoves"] == 1
    assert r["oneButBad"] == 1, "單曲循環但這首播不了：換下一首，不要卡住"
    assert set(r["shuffleNeverCurOrBad"]) <= {2, 3} and set(r["shuffleNeverCurOrBad"]) == {2, 3}
    assert r["shuffleAllBad"] == -1
    assert r["reasons"][0] == r["reasons"][1] == "上傳者不開放在其他網站播放"
    assert r["reasons"][2] == "這首影片已被刪除或設為私人" and r["reasons"][3] == "這首播放失敗"


def test_escape_html():
    """歌名、頻道名放進畫面前要跳脫，避免奇怪的歌名把畫面弄壞。"""
    if not shutil.which("node"):
        return
    r = run_node("""
    import * as c from './core/yt-core.js';
    console.log(JSON.stringify(c.escapeHtml('<img src=x onerror="a()"> & \\'')));
    """)
    assert r == "&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;"
