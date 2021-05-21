import * as cdk from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as ecs from "@aws-cdk/aws-ecs"
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns"
import * as iam from "@aws-cdk/aws-iam"
import * as ecr from "@aws-cdk/aws-ecr"
import * as s3 from "@aws-cdk/aws-s3"
import * as rds from "@aws-cdk/aws-rds"
import * as logs from "@aws-cdk/aws-logs"
import { v4 as uuid } from "uuid"
import * as dotenv from "dotenv"

dotenv.config()

export class AwsCdkEcsOnFargateSampleStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // 各リソースの接頭語
    const resoucePrefix: string = "aws-cdk-ecs-on-fargate-sample"
    
    // ECR(App)
    const appImageRepo = new ecr.Repository(this, "appImageRepo", {
      repositoryName: `${resoucePrefix}-app`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE
    })

    cdk.Tags.of(appImageRepo).add("Name", `${resoucePrefix}-app-image-repo`)

    // ECR(Nginx)
    const nginxImageRepo = new ecr.Repository(this, "nginxImageRepo", {
      repositoryName: `${resoucePrefix}-nginx`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE
    })

    cdk.Tags.of(nginxImageRepo).add("Name", `${resoucePrefix}-nginx-image-repo`)
    
    // VPC（次の記述だけでそれに紐づいたサブネット、インターネットゲートウェイ、ルートテーブルも同時に作成される）
    const vpc = new ec2.Vpc(this, "vpc", {
      cidr: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC
        }
      ]
    })

    cdk.Tags.of(vpc).add("Name", `${resoucePrefix}-vpc`)
    
    // セキュリティグループ(ALB用)
    const albSg = new ec2.SecurityGroup(this, "albSg", {
      vpc, // 本来は「vpc: vpc」という記述が正しいが、左辺と右辺が同じ場合は省略可能
      allowAllOutbound: true
    })

    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))
    albSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic()) // インバウンドとアウトバウンドは必ずセット

    cdk.Tags.of(albSg).add("Name", `${resoucePrefix}-alb-Sg`)

    // セキュリティグループ(DB用)
    const dbSg = new ec2.SecurityGroup(this, "dbSg", {
      vpc,
      allowAllOutbound: true
    })

    dbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306))
    dbSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic())

    cdk.Tags.of(dbSg).add("Name", `${resoucePrefix}-db-Sg`)

    // データベース(RDS)
    const db = new rds.DatabaseInstance(this, "db", {
      vpc,
      vpcSubnets: {
        subnets: vpc.publicSubnets
      },
      // どのデータベース、インスタンスタイプを使うかは各自お好みで
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
      instanceIdentifier: `${resoucePrefix}-db`,
      instanceType:  ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      databaseName: process.env.DATABASE_NAME || "",
      credentials: {
        username: process.env.DATABASE_USERNAME || "",
        password: cdk.SecretValue.plainText(process.env.DATABASE_PASSWORD || "")
      },
      port: 3306,
      multiAz: true,
      securityGroups: [dbSg]
    })

    cdk.Tags.of(db).add("Name", `${resoucePrefix}-db`)

    // IAMロール
    const ecsTaskExecutionRole = new iam.Role(this, "ecsTaskExecutionRole", {
      roleName: "ecs-task-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess")
      ]
    })

    cdk.Tags.of(ecsTaskExecutionRole).add("Name", `${resoucePrefix}-ecs-task-execution-role`)

    // クラスター
    const cluster = new ecs.Cluster(this, "cluster", {
      vpc,
      clusterName: `${resoucePrefix}-cluster`
    })

    cdk.Tags.of(cluster).add("Name", `${resoucePrefix}-cluster`)

    // ロググループ
    const logGroup = new logs.LogGroup(this, "logGroup", {
      logGroupName: "/aws/cdk/ecs/sample"
    })

    cdk.Tags.of(logGroup).add("Name", `${resoucePrefix}-log-group`)

    // タスク定義
    const taskDefinition = new ecs.FargateTaskDefinition(this, "taskDefinition", {
      family: `${resoucePrefix}-app-nginx`,
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole: ecsTaskExecutionRole,
      taskRole: ecsTaskExecutionRole
    })

    cdk.Tags.of(taskDefinition).add("Name", `${resoucePrefix}-task-definition`)

    // コンテナ定義（App）
    const appContainer = new ecs.ContainerDefinition(this, "appContainer", {
      containerName: "app",
      taskDefinition,
      // ECRからイメージを取得
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, "appImage", `${resoucePrefix}-app`)
      ),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "production",
        logGroup
      }),
      // 環境変数
      environment: {
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_NAME: process.env.DATABASE_NAME || "",
        DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || "",
        DATABASE_USERNAME: process.env.DATABASE_USERNAME || "",
        RAILS_ENV: "production",
        RAILS_MASTER_KEY: process.env.RAILS_MASTER_KEY || "",
        TZ: "Japan"
      },
      command: [
        "bash",
        "-c",
        "bundle exec rails db:migrate && bundle exec rails assets:precompile && bundle exec puma -C config/puma.rb"
      ],
      workingDirectory: "/myapp",
      essential: true
    })

    // コンテナ定義（Nginx）
    const nginxContainer = new ecs.ContainerDefinition(this, "nginxContainer", {
      containerName: "nginx",
      taskDefinition,
      // ECRからイメージを取得
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, "nginxImage", `${resoucePrefix}-nginx`)
      ),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "production",
        logGroup
      }),
      portMappings: [
        {
          protocol: ecs.Protocol.TCP,
          containerPort: 80
        }
      ],
      workingDirectory: "/myapp",
      essential: true
    })

    // Appコンテナをボリュームとして指定
    nginxContainer.addVolumesFrom({
      sourceContainer: "app",
      readOnly: false
    })

    // デフォルトのコンテナをNginxコンテナに指定
    taskDefinition.defaultContainer = nginxContainer

    // S3（ログ保管場所）
    const albLogsBucket = new s3.Bucket(this, `alb-logs-bucket-${uuid()}`) // バケット名は全世界においてユニークである必要があるのでuuidを使用
    cdk.Tags.of(albLogsBucket).add("Name", `${resoucePrefix}-alb-logs-bucket`)

    // サービス（次の記述だけでそれに紐づいたロードバランサーやターゲットグループが同時に作成される）
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "service", {
      serviceName: `${resoucePrefix}-service`,
      cluster,
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent:100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      publicLoadBalancer: true,
      securityGroups: [albSg, dbSg]
    })

    cdk.Tags.of(service).add("Name", `${resoucePrefix}-service`)
    service.loadBalancer.logAccessLogs(albLogsBucket)
  }
}
