#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "@aws-cdk/core"
import { AwsCdkEcsOnFargateSampleStack } from "../lib/aws-cdk-ecs-on-fargate-sample-stack"

const app = new cdk.App()
new AwsCdkEcsOnFargateSampleStack(app, "AwsCdkEcsOnFargateSampleStack", {
  env: { region: "ap-northeast-1" }
})
