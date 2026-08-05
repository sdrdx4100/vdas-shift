# VDAS Shift

車両計測データから、変速判断時の **エンジン回転数 × Dr要求トルク** を抽出し、実車ベースのシフト境界を推定するローカルWebシステムです。

元の [VDAS](https://github.com/sdrdx4100/vdas) と同じ考え方で、アップロード原本を保存し、DuckDBへ高速取込、SQLiteでデータセットとタグを管理します。

## 現在できること

- MF4 / MDF / CSV / Parquet の直接取込
- デコード済みMF4の信号読込
- Raw CAN/J1939を含むMF4へDBCを適用して信号抽出
- 信号名の自動候補提示と手動マッピング
- `TargetGear` が変化した瞬間を変速判断点として抽出
- Current Gear → Target Gearごとのアップ／ダウンシフト分離
- トルク帯ごとの回転数中央値、P10–P90、点数、信頼度を推定
- タグの保存・編集とデータセット絞り込みの基盤
- 元VDASを踏襲したダークテーマの解析UI

> このシステムが推定するのは、観測できた運転条件に対する経験的な変速境界です。ECU内部の正規マップや、温度・勾配・走行モード・変速抑制など未計測の内部状態を完全に復元するものではありません。

## 構成

- フロントエンド: Vinext / React / TypeScript
- API: FastAPI
- 計測データ: DuckDB
- メタデータ・タグ: SQLite
- MF4: asammdf（Raw CANデコード時はDBC / canmatrix）

## セットアップ

Python 3.11以上と Node.js 22以上を使用します。

```bash
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt
npm install
```

ターミナル1でAPIを起動します。

```bash
python run_backend.py                  # http://127.0.0.1:8711
```

ターミナル2で画面を起動します。

```bash
npm run dev                            # http://127.0.0.1:8710 相当
```

初期画面には操作確認用のデモデータが表示されます。APIへ接続できると、取り込んだ実データへ切り替わります。

## MF4の扱い

デコード済みチャンネルを持つMF4は、そのままアップロードできます。Raw CAN/J1939だけを含む場合は、アップロード画面で対応するDBCを追加してください。asammdfの `extract_bus_logging` でCAN信号を抽出してからDuckDBへ取り込みます。

現状はMF4全体をDataFrameへ展開してからDuckDBへ登録するMVP実装です。非常に大きなMF4を常用する場合は、次段でチャンネル選択先行・分割取込・バックグラウンドジョブ化を行います。

## 解析ロジック

1. `TargetGear` の変化を検出
2. その時点で `TargetGear != CurrentGear` なら変速判断点として採用
3. 判断時点の回転数・Dr要求トルク・現在／目標ギアを記録
4. ギア遷移とアップ／ダウン方向ごとに分割
5. トルク帯ごとの回転数中央値とP10–P90を計算

チャタリング対策として、既定で0.25秒以内の重複判断を除外します。

## API

- `POST /api/datasets/upload` — MF4 / CSV / Parquetと任意DBCを取込
- `GET /api/datasets` — データセット一覧
- `GET /api/datasets/{id}/schema` — 信号一覧と自動マッピング候補
- `PUT /api/datasets/{id}/tags` — タグ更新
- `POST /api/datasets/{id}/shift-map` — 変速イベント・推定境界を生成
- `GET /docs` — Swagger UI

## テスト

```bash
pytest backend/tests
npm run build
npm run lint
```

## データ保存先

既定では `data/` 配下です。`VDAS_SHIFT_DATA_DIR` 環境変数で変更できます。

```text
data/
  uploads/             アップロード原本
  dbc/                 アップロードされたDBC
  vdas_shift.duckdb    計測データ
  meta.sqlite          データセット・タグ・信号割当
```
