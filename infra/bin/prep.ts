/**
 * These stacks prepare the Dev account and Tools account for the Pipelines. They should be run first.
 *
 * Update config/index.ts with your account numbers and repo name before beginning.
 *
 * You will also need to run the Pipeline stacks from pipeline-deploy.ts after this stack.
 *
 * Deploy both stacks:
 * cdk deploy --all -a "npx ts-node bin/pipeline-setup.ts"
 */

import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CodeCommitStack, PipelinePrepStack } from "../lib/pipeline/prep-stack";
import { getConfig } from "./config";

const app = new App();
const config = getConfig("main", "FhirUtilsExample");

/**
 * Preparation stack for the Pipeline Account
 * Run this stack first.
 *
 * Deployment:
 * cdk deploy PipelineAccountPrepStack -a "npx ts-node bin/pipeline-setup.ts"
 */
const pipelinePrep = new PipelinePrepStack(
    app,
    `${config.stackNamePrefix}-${config.stackName}-PipelineAccountPrepStack`,
    {
        description: "Pipeline Account Prep Stack",
        env: { region: config.defaultRegion, account: config.toolsAccount },
        options: config,
    }
);

/**
 * Optionally create the CodeCommit repository.
 *
 * Deployment:
 * cdk deploy CodeCommitStack -a "npx ts-node bin/pipeline-setup.ts"
 */
const sourcePrep = new CodeCommitStack(
    app,
    `${config.stackNamePrefix}-${config.stackName}-CodeCommitStack`,
    {
        description: "CodeCommit Repository Stack",
        env: {
            region: config.defaultRegion,
            account: config.codeCommitAccount,
        },
        options: config,
    }
);
sourcePrep.addDependency(
    pipelinePrep,
    "Access to the event bus is required in Pipeline account"
);
