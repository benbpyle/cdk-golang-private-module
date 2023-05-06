#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PipelineStack } from "../lib/pipeline/pipeline-stack";

const app = new cdk.App();

new PipelineStack(app, `Sample-PipelineStack`);
