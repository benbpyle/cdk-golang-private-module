#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { getConfig } from "./config";
import { PipelineStack } from "../lib/pipeline/pipeline-stack";

const app = new cdk.App();
const config = getConfig("main", "FhirUtilsExample");

new PipelineStack(
    app,
    `${config.stackNamePrefix}-${config.stackName}-PipelineStack`,
    {
        env: {
            account: config.toolsAccount,
            region: config.defaultRegion,
        },
        options: config,
    }
);
