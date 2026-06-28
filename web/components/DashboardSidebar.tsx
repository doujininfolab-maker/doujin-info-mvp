const trendTags = [
  "監禁・束縛",
  "年の差",
  "執着",
  "幼なじみ",
  "同棲",
  "シチュエーションCD",
  "オメガバース",
  "片想い",
  "先輩×後輩",
  "癒やし",
];

const recentItems = [
  { title: "その瞳に恋をして", circle: "星屑ブランディ", time: "4分前", image: "/ui/product-01.svg" },
  { title: "君と過ごす休日の午後", circle: "はちみつカフェ", time: "12分前", image: "/ui/product-02.svg" },
  { title: "秘密ごとアパートメント", circle: "moonlit", time: "18分前", image: "/ui/product-03.svg" },
];

export function DashboardSidebar() {
  return (
    <aside className="dashboardSidebar" aria-label="サイドバー">
      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>⌁</span>急上昇タグ</h2>
        <div className="trendTagGrid">
          {trendTags.map((tag, index) => (
            <a className="trendTag" href="#" key={tag} title={tag}>
              <span className="trendTag__number">{index + 1}</span>
              <span className="trendTag__label">{tag}</span>
            </a>
          ))}
        </div>
        <a className="sidebarMore" href="#">もっと見る 〉</a>
      </section>

      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>☞</span>最近追加された作品</h2>
        <div className="recentList">
          {recentItems.map((item) => (
            <a className="recentItem" href="#" key={item.title}>
              <img src={item.image} alt="" loading="lazy" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.circle}</small>
                <em>{item.time}</em>
              </span>
            </a>
          ))}
        </div>
        <a className="sidebarMore" href="#">もっと見る 〉</a>
      </section>

      <section className="sidebarCard trendCard">
        <h2 className="sidebarCard__title"><span>◴</span>データで見るトレンド</h2>
        <p>日間売上トレンド（DLsite・女性向け）</p>
        <svg className="lineChart" viewBox="0 0 260 118" role="img" aria-label="日間売上トレンド">
          <g className="chartGrid">
            <line x1="0" x2="260" y1="24" y2="24" />
            <line x1="0" x2="260" y1="58" y2="58" />
            <line x1="0" x2="260" y1="92" y2="92" />
          </g>
          <polyline points="8,86 48,45 88,72 128,58 168,33 208,52 248,28" />
          {[8,48,88,128,168,208,248].map((x, i) => <circle key={x} cx={x} cy={[86,45,72,58,33,52,28][i]} r="4" />)}
          <g className="chartLabels"><text x="4" y="112">5/9</text><text x="202" y="112">5/15</text></g>
        </svg>
        <div className="shareBox">
          <div className="donut" />
          <ul>
            <li><span />ボーイズラブ <b>42%</b></li>
            <li><span />音声作品 <b>24%</b></li>
            <li><span />漫画 <b>18%</b></li>
            <li><span />ゲーム <b>8%</b></li>
            <li><span />その他 <b>8%</b></li>
          </ul>
        </div>
        <a className="sidebarMore" href="#">もっと詳しく見る 〉</a>
      </section>

      <section className="favoritePromo">
        <div>
          <h2>お気に入り機能で</h2>
          <p>気になる作品やサークルを保存！</p>
          <a href="#">無料で登録する</a>
        </div>
        <img src="/ui/promo-girl.svg" alt="" loading="lazy" />
      </section>
    </aside>
  );
}
