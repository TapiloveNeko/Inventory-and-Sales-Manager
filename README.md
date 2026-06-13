# 在庫・売上管理システム

仕入・売上を一覧で管理し、粗利を自動計算するWebアプリケーションです。

## 使用サービス

| レイヤー | サービス | 詳細 |
|---|---|---|
| フロント | [Render](https://render.com) | 静的ファイル（HTML / CSS / JS）の配信 |
| サーバー | [Render](https://render.com) | Node.js（Express）の実行環境 |
| データベース | [Neon](https://neon.tech) | サーバーレス PostgreSQL |

## 技術スタック

- **フロントエンド**：HTML / CSS / Vanilla JavaScript
- **バックエンド**：Node.js / Express
- **データベース**：PostgreSQL（Neon）
- **本番環境**：Render（Web Service）

## ローカル開発

### 必要なもの

- Node.js
- Yarn
- PostgreSQLが接続できる環境（ローカルまたはNeon）

### セットアップ

```bash
# パッケージをインストール
yarn

# .envファイルを作成
cp .env.example .env

# .envのDATABASE_URLを設定
# 例：DATABASE_URL=postgresql://localhost/inventory

# サーバー起動
yarn start
```

ブラウザで `http://localhost:3000` にアクセス。

## 本番環境URL

https://inventory-and-sales-manager-9zbs.onrender.com