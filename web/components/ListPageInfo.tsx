type ListPageInfoItem = {
  label: string;
  value: string | number;
};

export function ListPageInfo({
  title,
  description,
  items = [],
  note,
}: {
  title: string;
  description: string;
  items?: ListPageInfoItem[];
  note?: string;
}) {
  return (
    <div className="listPageInfo" aria-label="ページ説明">
      <div className="listPageInfo__text">
        <strong>{title}</strong>
        <p>{description}</p>
        {note ? <small>{note}</small> : null}
      </div>
      {items.length ? (
        <dl className="listPageInfo__items">
          {items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function ListEmptyState({
  title = "該当する作品がありません。",
  description = "条件を変えるか、TL / BL の切り替えや作品形式を変更してください。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="listEmptyState">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
