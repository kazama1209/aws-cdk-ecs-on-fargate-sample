# aws-cdk-ecs-on-fargate-sample

AWS CDKでECS環境（Fargate）を構築するためのサンプル。

デプロイ用のアプリは以下を参照。

https://github.com/kazama1209/rails6-sample-app

## セットアップ

必要なパッケージをインストール。

```
$ npm install
```

環境変数をセット。

```
$ cp .env.sample .env

DATABASE_NAME=
DATABASE_PASSWORD=
DATABASE_USERNAME=
RAILS_MASTER_KEY=
```

コンパイル。

```
$ npm run build
```

CloudFormationのテンプレートを作成。

```
$ cdk synth --profile <AWS CLIプロファイル名>
```

デプロイ。

```
$ cdk deploy --profile <AWS CLIプロファイル名>
```
